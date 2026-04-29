import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSitePopulation,
  getGetSiteDetailQueryKey,
  getGetNetworkSnapshotQueryKey,
  getGetDashboardOverviewQueryKey,
  getGetOverviewLeaderboardQueryKey,
  getGetOverviewMissionRiskMatrixQueryKey,
  getListSitesQueryKey,
  getListAlertsQueryKey,
  getListActivityQueryKey,
  getGetRecommendationsQueryKey,
  getGetTheaterBloodReadinessQueryKey,
  getGetOverviewCascadeQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, RotateCcw, Users } from "lucide-react";

type Props = {
  nodeId: string;
  nodeName: string;
  activeSupportedPopulation: number;
  seededActiveSupportedPopulation?: number | null;
};

function formatPop(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function SitePopulationEditor({
  nodeId,
  nodeName,
  activeSupportedPopulation,
  seededActiveSupportedPopulation,
}: Props) {
  const seeded =
    typeof seededActiveSupportedPopulation === "number" &&
    Number.isFinite(seededActiveSupportedPopulation)
      ? seededActiveSupportedPopulation
      : activeSupportedPopulation;
  const isEdited = activeSupportedPopulation !== seeded;

  const [open, setOpen] = React.useState(false);
  const [parText, setParText] = React.useState<string>(
    String(activeSupportedPopulation),
  );
  const [note, setNote] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const update = useUpdateSitePopulation();

  React.useEffect(() => {
    if (open) {
      setParText(String(activeSupportedPopulation));
      setNote("");
      setError(null);
    }
  }, [open, activeSupportedPopulation]);

  const parsed = React.useMemo(() => {
    const n = Number(parText);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }, [parText]);

  const submit = React.useCallback(
    async (override?: number) => {
      const value = override ?? parsed;
      if (value == null) {
        setError("Enter a non-negative whole number.");
        return;
      }
      setError(null);
      try {
        await update.mutateAsync({
          nodeId,
          data: {
            activeSupportedPopulation: value,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: getGetSiteDetailQueryKey(nodeId),
          }),
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getGetNetworkSnapshotQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetDashboardOverviewQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetOverviewLeaderboardQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetOverviewMissionRiskMatrixQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetOverviewCascadeQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetTheaterBloodReadinessQueryKey(),
          }),
          queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getGetRecommendationsQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getListActivityQueryKey(),
          }),
        ]);
        setOpen(false);
      } catch (e) {
        setError((e as Error)?.message ?? "Failed to update PAR");
      }
    },
    [parsed, nodeId, note, update, queryClient],
  );

  const isSubmitting = update.isPending;
  const isUnchanged = parsed === activeSupportedPopulation;

  return (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground"
      data-testid="site-par-summary"
    >
      <Users className="h-4 w-4" />
      <span>
        Population at Risk:{" "}
        <span
          className="font-semibold text-foreground"
          data-testid="site-par-value"
        >
          {formatPop(activeSupportedPopulation)}
        </span>
        {isEdited && (
          <span
            className="ml-1.5 text-xs italic text-amber-500"
            title={`Originally seeded at ${formatPop(seeded)}`}
            data-testid="site-par-edited-badge"
          >
            (edited · seeded {formatPop(seeded)})
          </span>
        )}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs gap-1"
        onClick={() => setOpen(true)}
        data-testid="site-par-edit-button"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isSubmitting) setOpen(next);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="site-par-edit-dialog"
        >
          <DialogHeader>
            <DialogTitle>Edit Population at Risk</DialogTitle>
            <DialogDescription>
              Update the supported population for {nodeName}. DOS, days-to-fail,
              recommendations, and alerts will recompute immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div>
              <Label htmlFor="par-input">Population at Risk</Label>
              <Input
                id="par-input"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={parText}
                onChange={(e) => setParText(e.target.value)}
                disabled={isSubmitting}
                data-testid="site-par-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Currently {formatPop(activeSupportedPopulation)} · seeded{" "}
                {formatPop(seeded)}
              </p>
            </div>
            <div>
              <Label htmlFor="par-note">Note (optional)</Label>
              <Textarea
                id="par-note"
                rows={2}
                placeholder="e.g. brigade surge — Op Iron Tide"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSubmitting}
                maxLength={500}
                data-testid="site-par-note"
              />
            </div>
            {error && (
              <p
                className="text-xs text-destructive"
                data-testid="site-par-error"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => void submit(seeded)}
              disabled={isSubmitting || activeSupportedPopulation === seeded}
              data-testid="site-par-reset-button"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to seeded value ({formatPop(seeded)})
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={isSubmitting || parsed == null || isUnchanged}
                data-testid="site-par-save-button"
              >
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
