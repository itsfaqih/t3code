import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ProviderInstanceId, type PullRequestGroupedReview } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "./Migrations.ts";
import {
  PullRequestGroupedReviews,
  layer,
  type GroupedReviewScope,
} from "./PullRequestGroupedReviews.ts";

const scope: GroupedReviewScope = {
  provider: "github",
  host: "github.com",
  repository: "owner/repo",
  number: 1,
  viewer: "reader",
};

const review: PullRequestGroupedReview = {
  id: "review-1",
  createdAt: "2026-10-07T00:00:00.000Z",
  headSha: "abc",
  baseBranch: "main",
  patchDigest: "digest",
  coverage: "partial",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  groups: [
    {
      id: "group-1",
      title: "Behavior",
      summary: "Inspect the change",
      completed: false,
      anchors: [{ path: "src/a.ts", side: "right", line: 3, text: "new" }],
    },
  ],
};

const db = it.layer(
  layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

db("PullRequestGroupedReviews", (it) => {
  it.effect("keeps completion scoped to the review and viewer", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const store = yield* PullRequestGroupedReviews;
      yield* store.insert(scope, review);
      const completed = yield* store.setProgress(scope, review.id, "group-1", true);
      assert.equal(completed.groups[0]?.completed, true);
      assert.equal((yield* store.list(scope))[0]?.groups[0]?.completed, true);
      assert.equal((yield* store.list({ ...scope, viewer: "other" })).length, 0);
      yield* store.setProgress(scope, review.id, "group-1", false);
      assert.equal((yield* store.list(scope))[0]?.groups[0]?.completed, false);
    }),
  );
});
