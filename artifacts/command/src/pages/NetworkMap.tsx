import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useGetNetworkSnapshot, getGetNetworkSnapshotQueryKey } from '@workspace/api-client-react';
import NetworkGLMap from '@/components/Map';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export default function NetworkMapPage() {
  const { data: snapshot, isLoading } = useGetNetworkSnapshot({
    query: { queryKey: getGetNetworkSnapshotQueryKey() },
  });

  return (
    <div className="h-full relative flex flex-col bg-background">
      <div className="absolute top-4 left-4 z-10 w-64">
        <Card className="bg-card/80 backdrop-blur-md border-border shadow-xl">
          <CardContent className="p-4 flex flex-col gap-4">
            <h3 className="font-semibold text-sm tracking-wider uppercase text-muted-foreground">Layers</h3>
            
            <div className="flex items-center space-x-2">
              <Checkbox id="nodes" defaultChecked />
              <Label htmlFor="nodes">Facilities & Nodes</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox id="routes" defaultChecked />
              <Label htmlFor="routes">Supply Routes</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox id="shipments" defaultChecked />
              <Label htmlFor="shipments">Active Shipments</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox id="threats" defaultChecked />
              <Label htmlFor="threats">Threat Overlays</Label>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 w-full h-full relative">
        <NetworkGLMap 
          nodes={snapshot?.nodes}
          routes={snapshot?.routes}
          shipments={snapshot?.shipments}
          riskByNode={snapshot?.riskByNode}
          threats={snapshot?.threats}
          onNodeClick={(node) => console.log(node)}
        />
      </div>
    </div>
  );
}
