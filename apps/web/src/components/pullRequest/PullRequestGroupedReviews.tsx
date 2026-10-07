import type {
  EnvironmentId,
  ModelSelection,
  PullRequestDetailView,
  PullRequestGroupedReview,
  PullRequestRef,
  PullRequestReviewAnchor,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { isPullRequestGroupedReviewStale } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { threadPullRequestKeysEqual } from "@t3tools/shared/threadPullRequests";
import { useMemo, useState } from "react";
import { BookOpenCheckIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
} from "~/providerInstances";

import { Button } from "../ui/button";

interface Props {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  threadRef: ScopedThreadRef | null;
  onOpenAnchor: (anchor: PullRequestReviewAnchor) => void;
}

export function PullRequestGroupedReviews({
  environmentId,
  reference,
  detail,
  threadRef,
  onOpenAnchor,
}: Props) {
  const serverConfig = useServerConfigs().get(environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const threads = useThreadShells();
  const providers = serverConfig?.providers ?? [];
  const options = useMemo(
    () =>
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings).filter(
        (entry) =>
          entry.enabled &&
          entry.isAvailable &&
          entry.status !== "error" &&
          ["codex", "claude", "opencode"].includes(entry.driverKind),
      ),
    [providers, settings],
  );
  const parsed = parseChangeRequestUrl(detail.url);
  const linksHere = (thread: (typeof threads)[number]) =>
    thread.environmentId === environmentId &&
    parsed !== null &&
    thread.pullRequests.some((link) => threadPullRequestKeysEqual(link, parsed));
  const linkedThread =
    threads.find((thread) => thread.id === threadRef?.threadId && linksHere(thread)) ??
    threads.find(linksHere);
  const linkedSelection = linkedThread?.modelSelection;
  const preferred = options.find((entry) => entry.instanceId === linkedSelection?.instanceId);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selected =
    options.find((entry) => entry.instanceId === chosenId) ?? preferred ?? options[0];
  const modelSelection: ModelSelection | null =
    selected === undefined
      ? null
      : preferred?.instanceId === selected.instanceId &&
          linkedSelection &&
          selected.models.some((model) => model.slug === linkedSelection.model)
        ? linkedSelection
        : {
            instanceId: selected.instanceId,
            model: getDefaultProviderInstanceModel(providers, selected.instanceId) ?? "",
          };

  const queryTarget = { environmentId, input: reference };
  const query = useEnvironmentQuery(pullRequestEnvironment.groupedReviews(queryTarget));
  const create = useAtomCommand(pullRequestEnvironment.createGroupedReview, {
    reportFailure: false,
  });
  const setProgress = useAtomCommand(pullRequestEnvironment.setGroupedReviewProgress, {
    reportFailure: false,
  });
  const [running, setRunning] = useState(false);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<PullRequestGroupedReview | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const reviews = query.data?.reviews ?? [];
  const review =
    current?.id === selectedReviewId || (selectedReviewId === null && current)
      ? current
      : (reviews.find((entry) => entry.id === selectedReviewId) ?? reviews[0] ?? null);
  const stale = review !== null && isPullRequestGroupedReviewStale(detail, review);

  const run = async () => {
    if (running || !modelSelection?.model) return;
    setRunning(true);
    setError(null);
    const result = await create({ environmentId, input: { ...reference, modelSelection } });
    setRunning(false);
    if (result._tag === "Success") {
      setCurrent(result.value);
      setSelectedReviewId(result.value.id);
      appAtomRegistry.refresh(pullRequestEnvironment.groupedReviews(queryTarget));
    } else {
      setError(String(squashAtomCommandFailure(result)));
    }
  };

  const mark = async (groupId: string, completed: boolean) => {
    if (!review || savingGroup !== null) return;
    setSavingGroup(groupId);
    setError(null);
    const result = await setProgress({
      environmentId,
      input: { ...reference, reviewId: review.id, groupId, completed },
    });
    setSavingGroup(null);
    if (result._tag === "Success") {
      setCurrent(result.value);
      appAtomRegistry.refresh(pullRequestEnvironment.groupedReviews(queryTarget));
    } else {
      setError(String(squashAtomCommandFailure(result)));
    }
  };

  return (
    <div className="h-full overflow-auto px-5 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-16">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <BookOpenCheckIcon className="size-4" /> Agent review
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Group the diff into a reading plan. This stays in T3 Code; nothing is posted to the
              host.
            </p>
          </div>
          <Button size="sm" disabled={running || !modelSelection?.model} onClick={() => void run()}>
            <SparklesIcon className="size-4" />{" "}
            {running ? "Reviewing..." : review ? "Review current revision" : "Review with agent"}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Agent</span>
          <select
            aria-label="Review agent"
            className="h-8 min-w-40 rounded-md border border-input bg-background px-2 text-sm"
            value={selected?.instanceId ?? ""}
            onChange={(event) => setChosenId(event.target.value)}
          >
            {options.length === 0 ? <option value="">No available agents</option> : null}
            {options.map((entry) => (
              <option key={entry.instanceId} value={entry.instanceId}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {query.error && reviews.length === 0 ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load saved reviews.
          </p>
        ) : null}
        {reviews.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Saved review</span>
            <select
              aria-label="Saved review"
              className="h-8 min-w-40 rounded-md border border-input bg-background px-2 text-sm"
              value={review?.id ?? ""}
              onChange={(event) => {
                setCurrent(null);
                setSelectedReviewId(event.target.value);
              }}
            >
              {reviews.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {new Date(entry.createdAt).toLocaleString()} · {entry.groups.length} groups
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {review ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{new Date(review.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>
                {review.coverage === "partial" ? "Partial diff coverage" : "Complete captured diff"}
              </span>
              {stale ? (
                <span className="rounded bg-warning/15 px-1.5 text-warning">Older revision</span>
              ) : null}
              {!stale && (review.headSha === null || detail.headSha === undefined) ? (
                <span>Revision could not be checked</span>
              ) : null}
            </div>
            <ol className="flex flex-col gap-3">
              {review.groups.map((group, index) => (
                <li key={group.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Mark ${group.title} complete`}
                      checked={group.completed}
                      disabled={savingGroup !== null}
                      onChange={(event) => void mark(group.id, event.target.checked)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium">
                        {index + 1}. {group.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{group.summary}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {group.anchors.map((anchor) => (
                          <button
                            key={`${anchor.path}:${anchor.side}:${anchor.line}`}
                            type="button"
                            disabled={stale}
                            aria-label={`${anchor.path}:${anchor.line} ${anchor.text}${stale ? " (older revision)" : ""}`}
                            onClick={() => onOpenAnchor(anchor)}
                            className="rounded border border-border px-2 py-1 text-left text-xs text-secondary-label hover:bg-accent disabled:cursor-default disabled:opacity-70"
                          >
                            {anchor.path}:{anchor.line}{" "}
                            <span className="text-muted-foreground">{anchor.side}</span>
                            {!stale ? <ExternalLinkIcon className="ml-1 inline size-3" /> : null}
                          </button>
                        ))}
                      </div>
                      {stale ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Saved lines from this revision:{" "}
                          {group.anchors
                            .map((anchor) => `${anchor.path}:${anchor.line} ${anchor.text}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : !running && !query.isPending ? (
          <p className="text-sm text-muted-foreground">
            No saved agent review for this pull request.
          </p>
        ) : null}
      </div>
    </div>
  );
}
