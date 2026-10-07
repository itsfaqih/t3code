import { describe, expect, it } from "vite-plus/test";
import type { PullRequestReviewAnchor } from "@t3tools/contracts";

import { getRenderablePatch } from "~/lib/diffRendering";
import { groupedDiffHeight, projectGroupedDiffFile } from "./pullRequestGroupedDiff.logic";

const patch = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1234567..abcdef0 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,15 +1,15 @@",
  " first",
  "-oldA",
  "+newA",
  " three",
  " four",
  " five",
  " six",
  " seven",
  " eight",
  " nine",
  " ten",
  "-oldB",
  "+newB",
  " twelve",
  " thirteen",
  " fourteen",
  " fifteen",
].join("\n");

function parsedFile(input = patch) {
  const parsed = getRenderablePatch(input, "grouped-test", { compactPartialHunkOffsets: true });
  if (parsed?.kind !== "files" || !parsed.files[0]) throw new Error("Expected a parsed diff");
  return parsed.files[0];
}

function anchor(
  side: "left" | "right",
  line: number,
  path = "src/example.ts",
): PullRequestReviewAnchor {
  return { path, side, line, text: `${side}:${line}` };
}

describe("projectGroupedDiffFile", () => {
  it("isolates groups anchored in different changes of one parsed hunk", () => {
    const file = parsedFile();
    expect(file.hunks).toHaveLength(1);
    const firstAnchor = anchor("right", 2);
    const secondAnchor = anchor("right", 11);
    const first = projectGroupedDiffFile(file, [firstAnchor], "group-a");
    const second = projectGroupedDiffFile(file, [secondAnchor], "group-b");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.matchedAnchors).toEqual([firstAnchor]);
    expect(second[0]?.matchedAnchors).toEqual([secondAnchor]);
    expect(first[0]?.fileDiff.additionLines).toEqual(["newA\n", "three\n", "four\n", "five\n"]);
    expect(first[0]?.fileDiff.deletionLines).toEqual(["oldA\n", "three\n", "four\n", "five\n"]);
    expect(second[0]?.fileDiff.additionLines).toEqual([
      "newB\n",
      "twelve\n",
      "thirteen\n",
      "fourteen\n",
    ]);
    expect(second[0]?.fileDiff.deletionLines).toEqual([
      "oldB\n",
      "twelve\n",
      "thirteen\n",
      "fourteen\n",
    ]);
    expect(first[0]?.fileDiff.additionLines).not.toContain("newB\n");
    expect(second[0]?.fileDiff.additionLines).not.toContain("newA\n");
    expect(first[0]?.fileDiff.deletionLines).toContain("oldA\n");
    expect(second[0]?.fileDiff.deletionLines).toContain("oldB\n");
    expect(first[0]?.fileDiff.deletionLines).not.toContain("oldB\n");
    expect(second[0]?.fileDiff.deletionLines).not.toContain("oldA\n");

    for (const snippet of [...first, ...second]) {
      const diff = snippet.fileDiff;
      const hunk = diff.hunks[0];
      expect(hunk?.collapsedBefore).toBe(0);
      expect(hunk?.additionLineIndex).toBe(0);
      expect(hunk?.deletionLineIndex).toBe(0);
      expect(hunk?.splitLineStart).toBe(0);
      expect(hunk?.unifiedLineStart).toBe(0);
      expect(hunk?.additionCount).toBe(diff.additionLines.length);
      expect(hunk?.deletionCount).toBe(diff.deletionLines.length);
      expect(hunk?.unifiedLineCount).toBe(diff.unifiedLineCount);
      expect(groupedDiffHeight(diff)).toBe(40 + diff.unifiedLineCount * 20);
    }
    expect(first[0]?.fileDiff.hunks[0]?.additionStart).toBe(2);
    expect(first[0]?.fileDiff.hunks[0]?.deletionStart).toBe(2);
    expect(second[0]?.fileDiff.hunks[0]?.additionStart).toBe(11);
    expect(second[0]?.fileDiff.hunks[0]?.deletionStart).toBe(11);
    expect(first[0]?.fileDiff.cacheKey).not.toBe(second[0]?.fileDiff.cacheKey);
  });

  it("keeps multiple relevant changes from one file in a single code view", () => {
    const file = parsedFile();
    const firstAnchor = anchor("right", 2);
    const secondAnchor = anchor("right", 11);
    const [snippet] = projectGroupedDiffFile(file, [firstAnchor, secondAnchor], "combined-group");

    expect(snippet?.matchedAnchors).toEqual([firstAnchor, secondAnchor]);
    expect(snippet?.fileDiff.hunks).toHaveLength(2);
    expect(snippet?.fileDiff.additionLines).toContain("newA\n");
    expect(snippet?.fileDiff.additionLines).toContain("newB\n");
    expect(snippet?.fileDiff.deletionLines).toContain("oldA\n");
    expect(snippet?.fileDiff.deletionLines).toContain("oldB\n");
    expect(snippet?.fileDiff.unifiedLineCount).toBe(
      snippet?.fileDiff.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0),
    );
    expect(snippet?.fileDiff.hunks[0]?.unifiedLineStart).toBe(0);
    expect(snippet?.fileDiff.hunks[1]?.unifiedLineStart).toBe(
      snippet?.fileDiff.hunks[0]?.unifiedLineCount,
    );
    expect(snippet?.fileDiff.hunks[1]?.additionLineIndex).toBe(
      snippet?.fileDiff.hunks[0]?.additionCount,
    );
    expect(snippet?.fileDiff.hunks[1]?.deletionLineIndex).toBe(
      snippet?.fileDiff.hunks[0]?.deletionCount,
    );
  });

  it("matches side coordinates and rename path aliases, leaving unmatched anchors for fallback", () => {
    const renamed = parsedFile(
      patch
        .replaceAll("src/example.ts", "src/new.ts")
        .replace("diff --git a/src/new.ts", "diff --git a/src/old.ts")
        .replace("--- a/src/new.ts", "--- a/src/old.ts")
        .replace(
          "index 1234567..abcdef0 100644",
          "similarity index 80%\nrename from src/old.ts\nrename to src/new.ts\nindex 1234567..abcdef0 100644",
        ),
    );
    const left = anchor("left", 2, "src/old.ts");
    const right = anchor("right", 11, "src/new.ts");
    const missing = anchor("right", 99, "src/new.ts");
    const snippets = projectGroupedDiffFile(renamed, [left, right, missing], "rename-group");
    const matched = new Set(snippets.flatMap((snippet) => snippet.matchedAnchors));

    expect(matched.has(left)).toBe(true);
    expect(matched.has(right)).toBe(true);
    expect(matched.has(missing)).toBe(false);
    expect(snippets.some((snippet) => snippet.fileDiff.deletionLines.includes("oldA\n"))).toBe(
      true,
    );
    expect(snippets.some((snippet) => snippet.fileDiff.additionLines.includes("newB\n"))).toBe(
      true,
    );
  });

  it("keeps a whitespace filtered anchor as context and marks it matched", () => {
    const whitespacePatch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,3 +1,3 @@",
      " before",
      "-value = 1",
      "+value  = 1",
      " after",
    ].join("\n");
    const parsed = getRenderablePatch(whitespacePatch, "whitespace-test", {
      ignoreWhitespace: true,
    });
    if (parsed?.kind !== "files" || !parsed.files[0]) throw new Error("Expected a parsed diff");
    const saved = anchor("right", 2);
    const snippets = projectGroupedDiffFile(parsed.files[0], [saved], "whitespace-group");
    expect(snippets[0]?.matchedAnchors).toEqual([saved]);
    expect(snippets[0]?.fileDiff.hunks[0]?.hunkContent).toEqual([
      { type: "context", lines: 3, additionLineIndex: 0, deletionLineIndex: 0 },
    ]);
  });

  it("keeps EOF markers only with their terminal source lines", () => {
    const eofPatch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,4 +1,4 @@",
      " first",
      "-old",
      "+new",
      " third",
      "-last old",
      "\\ No newline at end of file",
      "+last new",
      "\\ No newline at end of file",
    ].join("\n");
    const file = parsedFile(eofPatch);
    const earlier = projectGroupedDiffFile(file, [anchor("right", 2)], "earlier");
    const terminal = projectGroupedDiffFile(file, [anchor("right", 4)], "terminal");

    expect(file.hunks[0]?.noEOFCRAdditions).toBe(true);
    expect(file.hunks[0]?.noEOFCRDeletions).toBe(true);
    expect(earlier[0]?.fileDiff.hunks[0]?.noEOFCRAdditions).toBe(false);
    expect(earlier[0]?.fileDiff.hunks[0]?.noEOFCRDeletions).toBe(false);
    expect(terminal[0]?.fileDiff.hunks[0]?.noEOFCRAdditions).toBe(true);
    expect(terminal[0]?.fileDiff.hunks[0]?.noEOFCRDeletions).toBe(true);
    const both = projectGroupedDiffFile(file, [anchor("left", 4), anchor("right", 4)], "both");
    expect(both[0]?.fileDiff.hunks[0]?.noEOFCRAdditions).toBe(true);
    expect(both[0]?.fileDiff.hunks[0]?.noEOFCRDeletions).toBe(true);
  });
});
