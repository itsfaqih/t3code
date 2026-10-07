import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import {
  PullRequestGroupedReview,
  PullRequestGroupedReviewError,
  type SourceControlProviderKind,
} from "@t3tools/contracts";

export interface GroupedReviewScope {
  readonly provider: SourceControlProviderKind;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly viewer: string;
}

export class PullRequestGroupedReviews extends Context.Service<
  PullRequestGroupedReviews,
  {
    readonly list: (
      scope: GroupedReviewScope,
    ) => Effect.Effect<ReadonlyArray<PullRequestGroupedReview>, PullRequestGroupedReviewError>;
    readonly insert: (
      scope: GroupedReviewScope,
      review: PullRequestGroupedReview,
    ) => Effect.Effect<void, PullRequestGroupedReviewError>;
    readonly setProgress: (
      scope: GroupedReviewScope,
      reviewId: string,
      groupId: string,
      completed: boolean,
    ) => Effect.Effect<PullRequestGroupedReview, PullRequestGroupedReviewError>;
  }
>()("t3/persistence/PullRequestGroupedReviews") {}

const decodeReview = Schema.decodeEffect(Schema.fromJsonString(PullRequestGroupedReview));
const isGroupedReviewError = Schema.is(PullRequestGroupedReviewError);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const load = Effect.fn("PullRequestGroupedReviews.load")(function* (scope: GroupedReviewScope) {
    const rows = yield* sql<{ readonly result_json: string }>`
      SELECT result_json FROM pull_request_grouped_reviews
      WHERE provider = ${scope.provider} AND host = ${scope.host}
        AND repository = ${scope.repository} AND number = ${scope.number}
        AND viewer = ${scope.viewer}
      ORDER BY created_at DESC, id DESC LIMIT 30
    `;
    const progress = yield* sql<{ readonly review_id: string; readonly group_id: string }>`
      SELECT progress.review_id, progress.group_id
      FROM pull_request_grouped_review_progress progress
      JOIN pull_request_grouped_reviews review ON review.id = progress.review_id
      WHERE review.provider = ${scope.provider} AND review.host = ${scope.host}
        AND review.repository = ${scope.repository} AND review.number = ${scope.number}
        AND review.viewer = ${scope.viewer} AND progress.viewer = ${scope.viewer}
    `;
    const completed = new Set(progress.map((mark) => `${mark.review_id}\0${mark.group_id}`));
    return yield* Effect.forEach(rows, (row) =>
      decodeReview(row.result_json).pipe(
        Effect.map((review) => ({
          ...review,
          groups: review.groups.map((group) => ({
            ...group,
            completed: completed.has(`${review.id}\0${group.id}`),
          })),
        })),
      ),
    );
  });

  const mapError = (detail: string) => (cause: unknown) =>
    new PullRequestGroupedReviewError({ detail: `${detail}: ${String(cause)}` });

  return PullRequestGroupedReviews.of({
    list: (scope) => load(scope).pipe(Effect.mapError(mapError("Could not load grouped reviews"))),
    insert: (scope, review) =>
      sql`
      INSERT INTO pull_request_grouped_reviews
        (id, provider, host, repository, number, viewer, head_sha, patch_digest, created_at, result_json)
      VALUES
        (${review.id}, ${scope.provider}, ${scope.host}, ${scope.repository}, ${scope.number},
         ${scope.viewer}, ${review.headSha}, ${review.patchDigest}, ${review.createdAt}, ${JSON.stringify(review)})
    `.pipe(Effect.asVoid, Effect.mapError(mapError("Could not save grouped review"))),
    setProgress: (scope, reviewId, groupId, completed) =>
      Effect.gen(function* () {
        const reviews = yield* load(scope);
        const review = reviews.find((candidate) => candidate.id === reviewId);
        if (!review || !review.groups.some((group) => group.id === groupId)) {
          return yield* new PullRequestGroupedReviewError({
            detail: "That review group is unavailable.",
          });
        }
        if (completed) {
          yield* sql`
          INSERT OR IGNORE INTO pull_request_grouped_review_progress (review_id, group_id, viewer)
          VALUES (${reviewId}, ${groupId}, ${scope.viewer})
        `;
        } else {
          yield* sql`
          DELETE FROM pull_request_grouped_review_progress
          WHERE review_id = ${reviewId} AND group_id = ${groupId} AND viewer = ${scope.viewer}
        `;
        }
        return {
          ...review,
          groups: review.groups.map((group) =>
            group.id === groupId ? { ...group, completed } : group,
          ),
        };
      }).pipe(
        Effect.mapError((cause) =>
          isGroupedReviewError(cause) ? cause : mapError("Could not save review progress")(cause),
        ),
      ),
  });
});

export const layer = Layer.effect(PullRequestGroupedReviews, make);
