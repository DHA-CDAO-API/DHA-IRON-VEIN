import React from 'react';
import { useGetSeedStatus, useReseedDatabase, useListCatalogItems, getGetSeedStatusQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function DataAdmin() {
  const { data: status, isLoading: statusLoading } = useGetSeedStatus({
    query: { queryKey: getGetSeedStatusQueryKey(), refetchInterval: 10000 },
  });
  
  const { data: catalog, isLoading: catalogLoading } = useListCatalogItems({ limit: 10 });
  const reseed = useReseedDatabase();
  const { toast } = useToast();

  const handleReseed = () => {
    reseed.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Reseed Started', description: 'Database is being re-seeded.' });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Failed to start reseed.', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="h-full flex flex-col p-6 gap-6 bg-background overflow-y-auto">
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-2xl font-bold uppercase tracking-wider">Data Administration</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="border-border hover:bg-secondary">
            <FileText className="h-4 w-4 mr-2" /> Export Orders (CSV)
          </Button>
          <Button variant="outline" className="border-border hover:bg-secondary">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Balances (XLSX)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Seed Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? <div className="text-sm">Loading...</div> : (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nodes</span>
                  <span className="font-mono">{status?.nodes.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-mono">{status?.items.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balances</span>
                  <span className="font-mono">{status?.balances.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Routes</span>
                  <span className="font-mono">{status?.routes.toLocaleString()}</span>
                </div>
                <div className="pt-4 mt-2 border-t border-border/50">
                  <Button onClick={handleReseed} disabled={reseed.isPending} className="w-full bg-destructive/20 text-destructive hover:bg-destructive/30 border border-destructive/50">
                    {reseed.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Wipe & Reseed Database
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border md:col-span-2 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Box className="h-4 w-4 text-primary" />
              Catalog Preview ({catalog?.total.toLocaleString()} total)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            {catalogLoading ? <div className="p-4 text-sm">Loading...</div> : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="p-3 font-medium text-muted-foreground">Noun</th>
                    <th className="p-3 font-medium text-muted-foreground">Mfr</th>
                    <th className="p-3 font-medium text-muted-foreground">Type</th>
                    <th className="p-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {catalog?.items.map((item, i) => (
                    <tr key={i} className="hover:bg-muted/10">
                      <td className="p-3">{item.productNoun}</td>
                      <td className="p-3 text-muted-foreground">{item.manufacturer}</td>
                      <td className="p-3 text-muted-foreground">{item.productType}</td>
                      <td className="p-3">
                        {item.mapped ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10">MAPPED</Badge> : <Badge variant="outline" className="text-muted-foreground">UNMAPPED</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Ensure Box is imported
import { Box } from 'lucide-react';