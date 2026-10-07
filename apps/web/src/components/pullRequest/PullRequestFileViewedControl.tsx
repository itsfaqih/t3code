import { Checkbox } from "../ui/checkbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The shared per-file control used by both pull request diff views. */
export function PullRequestFileViewedControl({
  enabled,
  viewed,
  stale,
  onChange,
}: {
  enabled: boolean;
  viewed: boolean;
  stale: boolean;
  onChange: (viewed: boolean) => void;
}) {
  if (!enabled) return null;

  return (
    <label
      data-viewed-toggle=""
      className="flex cursor-pointer select-none items-center gap-1.5 text-2xs text-muted-foreground"
    >
      <Checkbox
        aria-label={stale ? "Changed" : "Viewed"}
        checked={viewed}
        onCheckedChange={(next) => onChange(next === true)}
      />
      {stale ? (
        <Tooltip>
          <TooltipTrigger render={<span className="text-warning-foreground" />}>
            Changed
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            This file has been pushed to since you marked it viewed.
          </TooltipPopup>
        </Tooltip>
      ) : (
        "Viewed"
      )}
    </label>
  );
}
