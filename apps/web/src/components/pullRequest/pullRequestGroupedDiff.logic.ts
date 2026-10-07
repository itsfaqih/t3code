import type { FileDiffMetadata } from "@pierre/diffs/types";
import type { PullRequestReviewAnchor } from "@t3tools/contracts";

import { fnv1a32, resolveFileDiffPath, resolveFileDiffPreviousPath } from "~/lib/diffRendering";

type Hunk = FileDiffMetadata["hunks"][number];

interface Row {
  readonly kind: "context" | "addition" | "deletion";
  readonly changeBlock: number | null;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly oldCursor: number;
  readonly newCursor: number;
  readonly oldText: string | null;
  readonly newText: string | null;
}

export interface GroupedDiffSnippet {
  readonly fileDiff: FileDiffMetadata;
  readonly matchedAnchors: ReadonlyArray<PullRequestReviewAnchor>;
}

function hunkRows(file: FileDiffMetadata, hunk: Hunk): Row[] {
  const rows: Row[] = [];
  let oldLine = hunk.deletionStart;
  let newLine = hunk.additionStart;
  let changeBlock = 0;
  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      for (let offset = 0; offset < content.lines; offset += 1) {
        rows.push({
          kind: "context",
          changeBlock: null,
          oldLine,
          newLine,
          oldCursor: oldLine,
          newCursor: newLine,
          oldText: file.deletionLines[content.deletionLineIndex + offset] ?? "",
          newText: file.additionLines[content.additionLineIndex + offset] ?? "",
        });
        oldLine += 1;
        newLine += 1;
      }
      continue;
    }
    changeBlock += 1;
    for (let offset = 0; offset < content.deletions; offset += 1) {
      rows.push({
        kind: "deletion",
        changeBlock,
        oldLine,
        newLine: null,
        oldCursor: oldLine,
        newCursor: newLine,
        oldText: file.deletionLines[content.deletionLineIndex + offset] ?? "",
        newText: null,
      });
      oldLine += 1;
    }
    for (let offset = 0; offset < content.additions; offset += 1) {
      rows.push({
        kind: "addition",
        changeBlock,
        oldLine: null,
        newLine,
        oldCursor: oldLine,
        newCursor: newLine,
        oldText: null,
        newText: file.additionLines[content.additionLineIndex + offset] ?? "",
      });
      newLine += 1;
    }
  }
  return rows;
}

function buildSnippet(
  file: FileDiffMetadata,
  hunk: Hunk,
  rows: ReadonlyArray<Row>,
  matchedAnchors: ReadonlyArray<PullRequestReviewAnchor>,
  scopeKey: string,
  snippetIndex: number,
): GroupedDiffSnippet {
  const additionLines: string[] = [];
  const deletionLines: string[] = [];
  const hunkContent: Hunk["hunkContent"] = [];
  for (const row of rows) {
    if (row.kind === "context") {
      const last = hunkContent.at(-1);
      if (last?.type === "context") last.lines += 1;
      else {
        hunkContent.push({
          type: "context",
          lines: 1,
          additionLineIndex: additionLines.length,
          deletionLineIndex: deletionLines.length,
        });
      }
      additionLines.push(row.newText ?? "");
      deletionLines.push(row.oldText ?? "");
    } else {
      const last = hunkContent.at(-1);
      const change = last?.type === "change" ? last : null;
      if (!change) {
        hunkContent.push({
          type: "change",
          additions: 0,
          deletions: 0,
          additionLineIndex: additionLines.length,
          deletionLineIndex: deletionLines.length,
        });
      }
      const current = hunkContent.at(-1);
      if (current?.type !== "change") continue;
      if (row.kind === "addition") {
        current.additions += 1;
        additionLines.push(row.newText ?? "");
      } else {
        current.deletions += 1;
        deletionLines.push(row.oldText ?? "");
      }
    }
  }

  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) throw new Error("A grouped diff snippet requires at least one row");
  const additionCount = additionLines.length;
  const deletionCount = deletionLines.length;
  const additionStart =
    additionCount > 0 ? (first.newLine ?? first.newCursor) : first.newCursor - 1;
  const deletionStart =
    deletionCount > 0 ? (first.oldLine ?? first.oldCursor) : first.oldCursor - 1;
  const splitLineCount = hunkContent.reduce(
    (total, content) =>
      total +
      (content.type === "context" ? content.lines : Math.max(content.additions, content.deletions)),
    0,
  );
  const nextHunk: Hunk = {
    ...hunk,
    collapsedBefore: 0,
    additionStart,
    additionCount,
    additionLines: rows.filter((row) => row.kind === "addition").length,
    additionLineIndex: 0,
    deletionStart,
    deletionCount,
    deletionLines: rows.filter((row) => row.kind === "deletion").length,
    deletionLineIndex: 0,
    hunkContent,
    hunkSpecs: `@@ -${deletionStart},${deletionCount} +${additionStart},${additionCount} @@`,
    splitLineStart: 0,
    splitLineCount,
    unifiedLineStart: 0,
    unifiedLineCount: rows.length,
    noEOFCRAdditions:
      hunk.noEOFCRAdditions &&
      rows.some((row) => row.newLine === hunk.additionStart + hunk.additionCount - 1),
    noEOFCRDeletions:
      hunk.noEOFCRDeletions &&
      rows.some((row) => row.oldLine === hunk.deletionStart + hunk.deletionCount - 1),
  };
  const identity = JSON.stringify([
    scopeKey,
    file.cacheKey,
    snippetIndex,
    rows.map((row) => [row.kind, row.oldLine, row.newLine, row.oldText, row.newText]),
  ]);
  const fileDiff: FileDiffMetadata = {
    ...file,
    isPartial: true,
    hunks: [nextHunk],
    additionLines,
    deletionLines,
    splitLineCount,
    unifiedLineCount: rows.length,
    cacheKey: `${file.cacheKey ?? "grouped"}:snippet:${fnv1a32(identity).toString(36)}`,
  };
  return { fileDiff, matchedAnchors };
}

function combineSnippets(
  file: FileDiffMetadata,
  snippets: ReadonlyArray<GroupedDiffSnippet>,
  scopeKey: string,
): GroupedDiffSnippet {
  const additionLines: string[] = [];
  const deletionLines: string[] = [];
  const hunks: Hunk[] = [];
  let splitLineStart = 0;
  let unifiedLineStart = 0;

  for (const { fileDiff } of snippets) {
    const hunk = fileDiff.hunks[0];
    if (!hunk) continue;
    const additionLineOffset = additionLines.length;
    const deletionLineOffset = deletionLines.length;
    hunks.push({
      ...hunk,
      additionLineIndex: additionLineOffset,
      deletionLineIndex: deletionLineOffset,
      hunkContent: hunk.hunkContent.map((content) => ({
        ...content,
        additionLineIndex: content.additionLineIndex + additionLineOffset,
        deletionLineIndex: content.deletionLineIndex + deletionLineOffset,
      })),
      collapsedBefore: 0,
      splitLineStart,
      unifiedLineStart,
    });
    splitLineStart += hunk.splitLineCount;
    unifiedLineStart += hunk.unifiedLineCount;
    additionLines.push(...fileDiff.additionLines);
    deletionLines.push(...fileDiff.deletionLines);
  }

  const matchedAnchors = Array.from(new Set(snippets.flatMap((snippet) => snippet.matchedAnchors)));
  const identity = JSON.stringify([
    scopeKey,
    file.cacheKey,
    snippets.map((snippet) => snippet.fileDiff.cacheKey),
  ]);
  return {
    fileDiff: {
      ...file,
      isPartial: true,
      hunks,
      additionLines,
      deletionLines,
      splitLineCount: splitLineStart,
      unifiedLineCount: unifiedLineStart,
      cacheKey: `${file.cacheKey ?? "grouped"}:snippet:${fnv1a32(identity).toString(36)}`,
    },
    matchedAnchors,
  };
}

export function projectGroupedDiffFile(
  file: FileDiffMetadata,
  anchors: ReadonlyArray<PullRequestReviewAnchor>,
  scopeKey: string,
): ReadonlyArray<GroupedDiffSnippet> {
  const currentPath = resolveFileDiffPath(file);
  const previousPath = resolveFileDiffPreviousPath(file);
  const fileAnchors = anchors.filter(
    (anchor) => anchor.path === currentPath || anchor.path === previousPath,
  );
  if (fileAnchors.length === 0) return [];

  const snippets: GroupedDiffSnippet[] = [];
  for (const hunk of file.hunks) {
    const rows = hunkRows(file, hunk);
    const matchedByRow = rows.map((row) =>
      fileAnchors.filter((anchor) =>
        anchor.side === "left" ? row.oldLine === anchor.line : row.newLine === anchor.line,
      ),
    );
    const included = rows.map((_, index) => Boolean(matchedByRow[index]?.length));
    const matchedChangeBlocks = new Set(
      rows.flatMap((row, index) =>
        matchedByRow[index]?.length && row.changeBlock !== null ? [row.changeBlock] : [],
      ),
    );
    for (let index = 0; index < rows.length; index += 1) {
      const changeBlock = rows[index]?.changeBlock;
      if (
        changeBlock !== null &&
        changeBlock !== undefined &&
        matchedChangeBlocks.has(changeBlock)
      ) {
        included[index] = true;
      }
    }
    for (let index = 0; index < rows.length; index += 1) {
      if (!matchedByRow[index]?.length) continue;
      for (const direction of [-1, 1]) {
        for (let distance = 1; distance <= 3; distance += 1) {
          const neighbor = index + direction * distance;
          if (rows[neighbor]?.kind !== "context") break;
          included[neighbor] = true;
        }
      }
    }
    for (let start = 0; start < rows.length;) {
      if (!included[start]) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (included[end]) end += 1;
      const snippetRows = rows.slice(start, end);
      const matchedAnchors = fileAnchors.filter((anchor) =>
        matchedByRow.slice(start, end).some((rowAnchors) => rowAnchors?.includes(anchor)),
      );
      snippets.push(
        buildSnippet(file, hunk, snippetRows, matchedAnchors, scopeKey, snippets.length),
      );
      start = end;
    }
  }
  if (snippets.length <= 1) return snippets;
  return [combineSnippets(file, snippets, scopeKey)];
}

export function groupedDiffHeight(file: FileDiffMetadata): number {
  return 32 + file.unifiedLineCount * 20 + 8;
}
