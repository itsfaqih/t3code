import { describe, expect, it } from "vite-plus/test";
import { isPullRequestGroupedReviewStale } from "@t3tools/contracts";

import { captureReviewPatch, changedReviewAnchors, validateReviewGroups } from "./groupedReview.ts";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -2,2 +2,3 @@",
  " context",
  "-old",
  "+new",
  "+more",
  "",
].join("\n");

describe("grouped pull request reviews", () => {
  it("anchors only actual changed lines from the captured patch", () => {
    const anchors = changedReviewAnchors(PATCH);
    expect(anchors.get(`src/a.ts\0left\0${3}`)?.text).toBe("old");
    expect(anchors.get(`src/a.ts\0right\0${3}`)?.text).toBe("new");
    const groups = validateReviewGroups(
      {
        groups: [
          {
            title: "  New behavior ",
            summary: " Read this.",
            anchors: [
              { path: "src/a.ts", side: "right", line: 3 },
              { path: "src/a.ts", side: "right", line: 99 },
              { path: "elsewhere.ts", side: "right", line: 3 },
            ],
          },
          {
            title: "Invented",
            summary: "No match",
            anchors: [{ path: "missing.ts", side: "right", line: 1 }],
          },
        ],
      },
      PATCH,
    );
    expect(groups).toEqual([
      {
        title: "New behavior",
        summary: "Read this.",
        anchors: [{ path: "src/a.ts", side: "right", line: 3, text: "new" }],
      },
    ]);
  });

  it("marks page limits and omitted hunks as partial coverage", () => {
    expect(captureReviewPatch({ patch: PATCH, truncated: false, nextCursor: null }).coverage).toBe(
      "complete",
    );
    expect(
      captureReviewPatch({ patch: PATCH, truncated: false, nextCursor: "next" }).coverage,
    ).toBe("partial");
    expect(captureReviewPatch({ patch: PATCH, truncated: true, nextCursor: null }).coverage).toBe(
      "partial",
    );
  });

  it("only calls a saved review stale when both head revisions are known and differ", () => {
    expect(
      isPullRequestGroupedReviewStale(
        { headSha: "new", baseBranch: "main" },
        { headSha: "old", baseBranch: "main" },
      ),
    ).toBe(true);
    expect(
      isPullRequestGroupedReviewStale(
        { headSha: "same", baseBranch: "main" },
        { headSha: "same", baseBranch: "main" },
      ),
    ).toBe(false);
    expect(
      isPullRequestGroupedReviewStale(
        { baseBranch: "main" },
        { headSha: "old", baseBranch: "main" },
      ),
    ).toBe(false);
    expect(
      isPullRequestGroupedReviewStale(
        { headSha: "new", baseBranch: "main" },
        { headSha: null, baseBranch: "main" },
      ),
    ).toBe(false);
    expect(
      isPullRequestGroupedReviewStale(
        { headSha: "same", baseBranch: "develop" },
        { headSha: "same", baseBranch: "main" },
      ),
    ).toBe(true);
  });
});
