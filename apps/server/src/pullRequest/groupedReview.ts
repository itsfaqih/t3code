import type { PullRequestDiffResult, PullRequestReviewAnchor } from "@t3tools/contracts";
import type { GroupedReviewGenerationResult } from "../textGeneration/TextGeneration.ts";

export const MAX_REVIEW_PATCH_LENGTH = 100_000;

export function captureReviewPatch(diff: PullRequestDiffResult) {
  const bounded = diff.patch.slice(0, MAX_REVIEW_PATCH_LENGTH);
  const patch =
    bounded.length === diff.patch.length
      ? bounded
      : bounded.slice(0, Math.max(0, bounded.lastIndexOf("\n") + 1));
  return {
    patch,
    coverage:
      diff.truncated || diff.nextCursor !== null || patch.length < diff.patch.length
        ? ("partial" as const)
        : ("complete" as const),
  };
}

function patchPath(line: string, prefix: string): string | null {
  if (line === `${prefix} /dev/null`) return null;
  const path = line.slice(prefix.length + 1);
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : null;
}

export function changedReviewAnchors(patch: string): ReadonlyMap<string, PullRequestReviewAnchor> {
  const anchors = new Map<string, PullRequestReviewAnchor>();
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = null;
      newPath = null;
      inHunk = false;
    } else if (line.startsWith("--- ")) {
      oldPath = patchPath(line, "---");
      inHunk = false;
    } else if (line.startsWith("+++ ")) {
      newPath = patchPath(line, "+++");
      inHunk = false;
    } else if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      inHunk = match !== null;
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
    } else if (inHunk && line.startsWith("+")) {
      if (newPath !== null) {
        const anchor = {
          path: newPath,
          side: "right" as const,
          line: newLine,
          text: line.slice(1),
        };
        anchors.set(`${anchor.path}\0${anchor.side}\0${anchor.line}`, anchor);
      }
      newLine++;
    } else if (inHunk && line.startsWith("-")) {
      if (oldPath !== null) {
        const anchor = { path: oldPath, side: "left" as const, line: oldLine, text: line.slice(1) };
        anchors.set(`${anchor.path}\0${anchor.side}\0${anchor.line}`, anchor);
      }
      oldLine++;
    } else if (inHunk && line.startsWith(" ")) {
      oldLine++;
      newLine++;
    } else if (inHunk && line !== "\\ No newline at end of file") {
      inHunk = false;
    }
  }
  return anchors;
}

export function validateReviewGroups(
  generated: GroupedReviewGenerationResult,
  patch: string,
): ReadonlyArray<{
  title: string;
  summary: string;
  anchors: ReadonlyArray<PullRequestReviewAnchor>;
}> {
  const valid = changedReviewAnchors(patch);
  return generated.groups.slice(0, 12).flatMap((group) => {
    const title = group.title.trim().slice(0, 120);
    const summary = group.summary.trim().slice(0, 1200);
    const anchors = group.anchors.slice(0, 8).flatMap(({ path, side, line }) => {
      const anchor = valid.get(`${path}\0${side}\0${line}`);
      return anchor ? [anchor] : [];
    });
    return title && summary && anchors.length > 0 ? [{ title, summary, anchors }] : [];
  });
}
