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
import { BookOpenCheckIcon, ExternalLinkIcon, FileDiffIcon, SparklesIcon } from "lucide-react";

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

const groupFiles = (anchors: ReadonlyArray<PullRequestReviewAnchor>) => {
  const anchorsByPath = new Map<string, Array<PullRequestReviewAnchor>>();
  for (const anchor of anchors) {
    const fileAnchors = anchorsByPath.get(anchor.path);
    if (fileAnchors) fileAnchors.push(anchor);
    else anchorsByPath.set(anchor.path, [anchor]);
  }

  return Array.from(anchorsByPath, ([path, fileAnchors]) => {
    const separator = path.lastIndexOf("/");
    return {
      path,
      name: path.slice(separator + 1),
      directory: separator === -1 ? "" : path.slice(0, separator + 1),
      anchors: fileAnchors,
    };
  });
};

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
  const completedGroups = review?.groups.filter((group) => group.completed).length ?? 0;

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
    <div className="@container/guide h-full overflow-auto px-5 py-5 xl:px-8">
      <div className="w-full pb-16">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-5 @min-[56rem]/guide:flex-row @min-[56rem]/guide:items-end @min-[56rem]/guide:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <BookOpenCheckIcon className="size-4" /> Review guide
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Read the change by topic, then open a changed line when you need its diff context.
              This guide stays in T3 Code; nothing is posted to the host.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Agent</span>
              <select
                aria-label="Review agent"
                className="h-9 min-w-40 rounded-md border border-input bg-background px-2 text-sm"
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
            <Button
              size="sm"
              className="h-9"
              disabled={running || !modelSelection?.model}
              onClick={() => void run()}
            >
              <SparklesIcon className="size-4" />{" "}
              {running ? "Reviewing..." : review ? "Review current revision" : "Review with agent"}
            </Button>
          </div>
        </header>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {query.error && reviews.length === 0 ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Could not load saved reviews.
          </p>
        ) : null}
        {reviews.length > 1 ? (
          <label className="mt-4 flex w-fit items-center gap-2 text-sm">
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
            <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pb-4 text-xs text-muted-foreground">
              <span>{new Date(review.createdAt).toLocaleString()}</span>
              <span aria-hidden="true">·</span>
              <span>
                {review.coverage === "partial" ? "Partial diff coverage" : "Complete captured diff"}
              </span>
              {stale ? (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">
                  Older revision
                </span>
              ) : null}
              {!stale && (review.headSha === null || detail.headSha === undefined) ? (
                <span>Revision could not be checked</span>
              ) : null}
              <span className="ml-auto tabular-nums">
                {completedGroups} / {review.groups.length} groups reviewed
              </span>
            </div>
            <ol className="divide-y divide-border/60">
              {review.groups.map((group, index) => {
                const files = groupFiles(group.anchors);

                return (
                  <li key={group.id} className="py-8 first:pt-6">
                    <div className="grid min-w-0 grid-cols-1 gap-5 @min-[64rem]/guide:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,1.4fr)] @min-[64rem]/guide:gap-8">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {String(index + 1).padStart(2, "0")} /{" "}
                          {String(review.groups.length).padStart(2, "0")}
                        </p>
                        <h3 className="mt-2 text-xl font-medium leading-tight">{group.title}</h3>
                        <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
                          {group.summary}
                        </p>
                        {files.length > 0 ? (
                          <div className="mt-5 space-y-2">
                            {files.map((file) => (
                              <div
                                key={file.path}
                                className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                              >
                                <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-mono text-xs font-medium">
                                    {file.name}
                                  </p>
                                  <p className="truncate text-2xs text-muted-foreground">
                                    {file.directory || file.path}
                                  </p>
                                </div>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {file.anchors.length} lines
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Changed files
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {files.length} files · {group.anchors.length} changed lines
                            </p>
                          </div>
                          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              aria-label={`Mark ${group.title} complete`}
                              checked={group.completed}
                              disabled={savingGroup !== null}
                              onChange={(event) => void mark(group.id, event.target.checked)}
                              className="size-4 accent-primary"
                            />
                            Reviewed
                          </label>
                        </div>
                        {files.length > 0 ? (
                          <div className="space-y-2">
                            {files.map((file) => (
                              <section
                                key={file.path}
                                className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-background/50"
                              >
                                <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
                                  <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 truncate font-mono text-xs font-medium">
                                    {file.name}
                                  </span>
                                  {file.directory ? (
                                    <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                                      {file.directory}
                                    </span>
                                  ) : null}
                                  <span className="ml-auto shrink-0 rounded bg-background px-1.5 py-0.5 text-3xs text-muted-foreground">
                                    {file.anchors.length} changed{" "}
                                    {file.anchors.length === 1 ? "line" : "lines"}
                                  </span>
                                </div>
                                <div className="divide-y divide-border/50">
                                  {file.anchors.map((anchor) => (
                                    <button
                                      key={`${anchor.path}:${anchor.side}:${anchor.line}`}
                                      type="button"
                                      disabled={stale}
                                      aria-label={`${anchor.path}:${anchor.line} ${anchor.text}${stale ? " (older revision)" : ""}`}
                                      onClick={() => onOpenAnchor(anchor)}
                                      className="group flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                                    >
                                      <span className="shrink-0 rounded bg-muted px-1.5 py-1 font-mono text-3xs text-muted-foreground">
                                        {anchor.line}
                                      </span>
                                      <span className="shrink-0 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {anchor.side}
                                      </span>
                                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-secondary-label">
                                        {anchor.text}
                                      </code>
                                      {!stale ? (
                                        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                                      ) : null}
                                    </button>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                            No validated changed-line anchors in this group.
                          </div>
                        )}
                        {stale ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            This guide is from an older revision. Saved lines are shown for
                            reference.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        ) : !running && !query.isPending ? (
          <div className="mt-6 rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
            <BookOpenCheckIcon className="mx-auto size-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No guide for this pull request yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Ask an agent to group the captured diff into a reading plan with links to changed
              lines.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
