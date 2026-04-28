import { Droplet } from "lucide-react";
import type { NodeBloodReadiness } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ViableUnitsPanel } from "./ViableUnitsPanel";
import { ColdChainPanel } from "./ColdChainPanel";
import { DonorPoolPanel } from "./DonorPoolPanel";
import { TestingSuppliesPanel } from "./TestingSuppliesPanel";

export function BloodReadinessTab({
  data,
  isLoading,
}: {
  data: NodeBloodReadiness | null | undefined;
  isLoading?: boolean;
}) {
  if (isLoading && !data) {
    return (
      <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <Droplet className="h-8 w-8 text-muted-foreground/40" />
        This site does not store blood products and has no cold-chain assets or donor pool.
      </div>
    );
  }

  return (
    <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="xl:col-span-2">
        <ViableUnitsPanel data={data} />
      </div>
      <ColdChainPanel data={data.coldChain} />
      <DonorPoolPanel data={data.donors} />
      <div className="xl:col-span-2">
        <TestingSuppliesPanel data={data.testingSupplies} />
      </div>
    </div>
  );
}
