import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  PullRequestGroupedReviewError,
  type PullRequestRef,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { traceLocalHandlerWork } from "../cloud/traceRelayRequest.ts";
import * as GroupedReviews from "../persistence/PullRequestGroupedReviews.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { captureReviewPatch, changedReviewAnchors, validateReviewGroups } from "./groupedReview.ts";
import * as PullRequestService from "./PullRequestService.ts";

/** The patch is often the largest PR payload and benefits from HTTP compression and flow control. */
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "pullRequests",
  Effect.fnUntraced(function* (handlers) {
    const pullRequests = yield* PullRequestService.PullRequestService;
    const reviews = yield* GroupedReviews.PullRequestGroupedReviews;
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const crypto = yield* Crypto.Crypto;
    const scopeFor = (reference: PullRequestRef) =>
      pullRequests.routing(reference).pipe(
        Effect.map((routing) => ({
          provider: routing.provider,
          host: routing.host.toLowerCase(),
          repository: reference.repository.toLowerCase(),
          number: reference.number,
          viewer: routing.viewer,
          workspaceRoot: routing.workspaceRoot,
        })),
      );
    return handlers
      .handle(
        "diff",
        Effect.fn("environment.pullRequests.diff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* pullRequests.diff(args.payload).pipe(traceLocalHandlerWork);
        }),
      )
      .handle(
        "groupedReviews",
        Effect.fn("environment.pullRequests.groupedReviews")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const { workspaceRoot: _workspaceRoot, ...scope } = yield* scopeFor(args.payload);
          return { reviews: yield* reviews.list(scope) };
        }),
      )
      .handle(
        "createGroupedReview",
        Effect.fn("environment.pullRequests.createGroupedReview")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const { modelSelection, ...reference } = args.payload;
          const scope = yield* scopeFor(reference);
          const instance = yield* instances.getInstance(modelSelection.instanceId);
          if (
            !instance?.enabled ||
            !["codex", "claude", "opencode"].includes(instance.driverKind)
          ) {
            return yield* new PullRequestGroupedReviewError({
              detail: "Choose an enabled Codex, Claude, or OpenCode agent for this review.",
            });
          }
          const generate = instance.textGeneration.generateGroupedReview;
          if (!generate) {
            return yield* new PullRequestGroupedReviewError({
              detail: "This agent cannot generate grouped reviews.",
            });
          }
          yield* pullRequests.invalidate({ reference });
          const before = yield* pullRequests.detail(reference);
          const diff = yield* pullRequests.diff(reference);
          yield* pullRequests.invalidate({ reference });
          const after = yield* pullRequests.detail(reference);
          if (
            before.baseBranch !== after.baseBranch ||
            (before.headSha && after.headSha && before.headSha !== after.headSha)
          ) {
            return yield* new PullRequestGroupedReviewError({
              detail: "New commits arrived while the diff was read. Refresh and try again.",
            });
          }
          const capture = captureReviewPatch(diff);
          const patchDigest = yield* crypto
            .digest("SHA-256", new TextEncoder().encode(capture.patch))
            .pipe(
              Effect.map(Hex.encode),
              Effect.mapError(
                () =>
                  new PullRequestGroupedReviewError({
                    detail: "Could not identify this diff revision.",
                  }),
              ),
            );
          if (changedReviewAnchors(capture.patch).size === 0) {
            return yield* new PullRequestGroupedReviewError({
              detail: "This diff has no changed text lines to group.",
            });
          }
          const generated = yield* generate({
            cwd: scope.workspaceRoot,
            patch: capture.patch,
            modelSelection,
          }).pipe(
            Effect.mapError(
              (cause) => new PullRequestGroupedReviewError({ detail: cause.message }),
            ),
          );
          const groups = yield* Effect.forEach(
            validateReviewGroups(generated, capture.patch),
            (group) =>
              crypto.randomUUIDv4.pipe(
                Effect.map((id) => ({ ...group, id, completed: false })),
                Effect.mapError(
                  () => new PullRequestGroupedReviewError({ detail: "Could not save the review." }),
                ),
              ),
          );
          if (groups.length === 0) {
            return yield* new PullRequestGroupedReviewError({
              detail: "The agent returned no groups with valid diff lines. Try the review again.",
            });
          }
          const review = {
            id: yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                () => new PullRequestGroupedReviewError({ detail: "Could not save the review." }),
              ),
            ),
            createdAt: DateTime.formatIso(yield* DateTime.now),
            headSha: before.headSha ?? null,
            baseBranch: before.baseBranch,
            patchDigest,
            coverage: capture.coverage,
            modelSelection,
            groups,
          };
          yield* reviews.insert(scope, review);
          return review;
        }),
      )
      .handle(
        "setGroupedReviewProgress",
        Effect.fn("environment.pullRequests.setGroupedReviewProgress")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const { reviewId, groupId, completed, ...reference } = args.payload;
          const { workspaceRoot: _workspaceRoot, ...scope } = yield* scopeFor(reference);
          return yield* reviews.setProgress(scope, reviewId, groupId, completed);
        }),
      );
  }),
);
