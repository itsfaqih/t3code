import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { PullRequestDiffSide, PullRequestRef } from "./pullRequest.ts";

export const PullRequestReviewAnchor = Schema.Struct({
  path: TrimmedNonEmptyString,
  side: PullRequestDiffSide,
  line: Schema.Int.check(Schema.isGreaterThan(0)),
  /** The exact changed line from the captured patch, so old reviews remain readable. */
  text: Schema.String,
});
export type PullRequestReviewAnchor = typeof PullRequestReviewAnchor.Type;

export const PullRequestReviewGroup = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  anchors: Schema.Array(PullRequestReviewAnchor).check(Schema.isMaxLength(8)),
  completed: Schema.Boolean,
});
export type PullRequestReviewGroup = typeof PullRequestReviewGroup.Type;

export const PullRequestGroupedReview = Schema.Struct({
  id: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  headSha: Schema.NullOr(TrimmedNonEmptyString),
  baseBranch: TrimmedNonEmptyString,
  patchDigest: TrimmedNonEmptyString,
  coverage: Schema.Literals(["complete", "partial"]),
  modelSelection: ModelSelection,
  groups: Schema.Array(PullRequestReviewGroup).check(Schema.isMaxLength(12)),
});
export type PullRequestGroupedReview = typeof PullRequestGroupedReview.Type;

export function isPullRequestGroupedReviewStale(
  current: { readonly headSha?: string | undefined; readonly baseBranch: string },
  review: { readonly headSha: string | null; readonly baseBranch: string },
): boolean {
  return (
    current.baseBranch !== review.baseBranch ||
    (current.headSha !== undefined && review.headSha !== null && current.headSha !== review.headSha)
  );
}

export const PullRequestGroupedReviewListInput = PullRequestRef;
export type PullRequestGroupedReviewListInput = typeof PullRequestGroupedReviewListInput.Type;
export const PullRequestGroupedReviewListResult = Schema.Struct({
  reviews: Schema.Array(PullRequestGroupedReview),
});
export type PullRequestGroupedReviewListResult = typeof PullRequestGroupedReviewListResult.Type;

export const PullRequestGroupedReviewCreateInput = Schema.Struct({
  ...PullRequestRef.fields,
  modelSelection: ModelSelection,
});
export type PullRequestGroupedReviewCreateInput = typeof PullRequestGroupedReviewCreateInput.Type;

export const PullRequestGroupedReviewProgressInput = Schema.Struct({
  ...PullRequestRef.fields,
  reviewId: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  completed: Schema.Boolean,
});
export type PullRequestGroupedReviewProgressInput =
  typeof PullRequestGroupedReviewProgressInput.Type;

export class PullRequestGroupedReviewError extends Schema.TaggedError<PullRequestGroupedReviewError>()(
  "PullRequestGroupedReviewError",
  { detail: Schema.String },
  { httpApiStatus: 422 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(PullRequestGroupedReviewError)(this, { status: 422 });
  }
  override get message(): string {
    return this.detail;
  }
}
