import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSiteTlammConfig,
  useListAors,
  useListTlamms,
  getGetSiteDetailQueryKey,
  getListSitesQueryKey,
  getGetNetworkSnapshotQueryKey,
  getListTlammsQueryKey,
  type UpdateTlammConfigInput,
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const NONE_VALUE = "__none__";

export type EditTlammDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  nodeId: string;
  nodeName: string;
  initial: {
    isTlamm: boolean;
    aorId: string | null;
    primaryTlammNodeId: string | null;
  };
};

export function EditTlammDialog({
  open,
  onOpenChange,
  nodeId,
  nodeName,
  initial,
}: EditTlammDialogProps) {
  const queryClient = useQueryClient();
  const { data: aors } = useListAors();
  const { data: tlamms } = useListTlamms();
  const updateConfig = useUpdateSiteTlammConfig();

  const [isTlamm, setIsTlamm] = useState(initial.isTlamm);
  const [aorId, setAorId] = useState<string | null>(initial.aorId);
  const [primaryTlammNodeId, setPrimaryTlammNodeId] = useState<string | null>(
    initial.primaryTlammNodeId,
  );
  const [error, setError] = useState<string | null>(null);

  // Re-sync local state whenever the dialog is opened on a new site or the
  // upstream values change.
  useEffect(() => {
    if (open) {
      setIsTlamm(initial.isTlamm);
      setAorId(initial.aorId);
      setPrimaryTlammNodeId(initial.primaryTlammNodeId);
      setError(null);
    }
  }, [open, initial.isTlamm, initial.aorId, initial.primaryTlammNodeId]);

  // A site cannot be its own primary TLAMM.
  const tlammOptions = (tlamms ?? []).filter((t) => t.nodeId !== nodeId);

  const submit = async () => {
    setError(null);
    if (isTlamm && primaryTlammNodeId && primaryTlammNodeId === nodeId) {
      setError("A TLAMM cannot have itself as its primary TLAMM.");
      return;
    }
    const body: UpdateTlammConfigInput = {
      isTlamm,
      aorId: aorId ?? null,
      primaryTlammNodeId: isTlamm ? null : primaryTlammNodeId ?? null,
    };
    try {
      await updateConfig.mutateAsync({ nodeId, data: body });
      // Refresh the views that surface TLAMM/AOR information.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetSiteDetailQueryKey(nodeId) }),
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetNetworkSnapshotQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListTlammsQueryKey() }),
      ]);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update TLAMM config";
      setError(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit TLAMM / AOR — {nodeName}</DialogTitle>
          <DialogDescription>
            Configure this site's TLAMM designation, its AOR membership, and (for
            downstream MTFs) which TLAMM it should pull from first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="tlamm-toggle" className="font-medium">
                Mark as TLAMM hub
              </Label>
              <p className="text-xs text-muted-foreground">
                TLAMM hubs are the AOR's primary intra-theater stockpile.
              </p>
            </div>
            <Switch
              id="tlamm-toggle"
              checked={isTlamm}
              onCheckedChange={setIsTlamm}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aor-select">AOR (Area of Responsibility)</Label>
            <Select
              value={aorId ?? NONE_VALUE}
              onValueChange={(v) => setAorId(v === NONE_VALUE ? null : v)}
            >
              <SelectTrigger id="aor-select">
                <SelectValue placeholder="Select AOR" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— None —</SelectItem>
                {(aors ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isTlamm ? (
            <div className="space-y-1.5">
              <Label htmlFor="primary-tlamm-select">Primary TLAMM (first source)</Label>
              <Select
                value={primaryTlammNodeId ?? NONE_VALUE}
                onValueChange={(v) =>
                  setPrimaryTlammNodeId(v === NONE_VALUE ? null : v)
                }
              >
                <SelectTrigger id="primary-tlamm-select">
                  <SelectValue placeholder="Select TLAMM" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— None —</SelectItem>
                  {tlammOptions.map((t) => (
                    <SelectItem key={t.nodeId} value={t.nodeId}>
                      {t.name}
                      {t.aorName ? ` · ${t.aorName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Replenishment is sourced from this TLAMM first; outside suppliers
                are tried only when the hub cannot cover the demand.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={updateConfig.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
