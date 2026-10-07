import type {
  PullRequestGroupedReview,
  PullRequestGroupedReviewCreateInput,
  PullRequestGroupedReviewListResult,
  PullRequestGroupedReviewProgressInput,
  PullRequestRef,
  PullRequestGroupedReviewError,
  PullRequestOperationError,
  PullRequestUnavailableError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const REVIEW_TIMEOUT_MS = 240_000;
type ReviewRequestError =
  | RemoteEnvironmentRequestError
  | PullRequestGroupedReviewError
  | PullRequestOperationError
  | PullRequestUnavailableError;

export class PullRequestGroupedReviewsLoader extends Context.Service<
  PullRequestGroupedReviewsLoader,
  {
    readonly list: (
      prepared: PreparedConnection,
      reference: PullRequestRef,
    ) => Effect.Effect<PullRequestGroupedReviewListResult, ReviewRequestError>;
    readonly create: (
      prepared: PreparedConnection,
      input: PullRequestGroupedReviewCreateInput,
    ) => Effect.Effect<PullRequestGroupedReview, ReviewRequestError>;
    readonly setProgress: (
      prepared: PreparedConnection,
      input: PullRequestGroupedReviewProgressInput,
    ) => Effect.Effect<PullRequestGroupedReview, ReviewRequestError>;
  }
>()(
  "@t3tools/client-runtime/state/pullRequestGroupedReviewsHttp/PullRequestGroupedReviewsLoader",
) {}

export const layer = Layer.effect(
  PullRequestGroupedReviewsLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    return PullRequestGroupedReviewsLoader.of({
      list: (prepared, reference) =>
        executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "pullRequests",
          method: "POST",
          timeoutMs: 60_000,
          url: (base) => makeEnvironmentHttpApiUrlBuilder(base).pullRequests.groupedReviews(),
          request: ({ client, headers }) => client.groupedReviews({ payload: reference, headers }),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      create: (prepared, input) =>
        executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "pullRequests",
          method: "POST",
          timeoutMs: REVIEW_TIMEOUT_MS,
          url: (base) => makeEnvironmentHttpApiUrlBuilder(base).pullRequests.createGroupedReview(),
          request: ({ client, headers }) => client.createGroupedReview({ payload: input, headers }),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      setProgress: (prepared, input) =>
        executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "pullRequests",
          method: "POST",
          timeoutMs: 60_000,
          url: (base) =>
            makeEnvironmentHttpApiUrlBuilder(base).pullRequests.setGroupedReviewProgress(),
          request: ({ client, headers }) =>
            client.setGroupedReviewProgress({ payload: input, headers }),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
    });
  }),
);
