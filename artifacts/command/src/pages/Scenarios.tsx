import React from 'react';
import { useListPresetEvents, useListScenarios } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayCircle, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AiBadge } from '@/components/ui/ai-badge';

export default function Scenarios() {
  const { data: presets, isLoading: presetsLoading } = useListPresetEvents();
  const { data: scenarios, isLoading: scenariosLoading } = useListScenarios();

  return (
    <div className="h-full flex p-4 gap-4 bg-background text-foreground overflow-hidden">
      {/* Left Rail - Builder */}
      <div className="w-[320px] flex flex-col gap-4 shrink-0 overflow-y-auto">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">Scenario Builder</div>
        
        {presetsLoading ? <Skeleton className="h-48" /> : presets?.map(preset => (
          <Card key={preset.id} className="bg-card/50 border-border cursor-pointer hover:border-primary/50 transition-colors group">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-sm group-hover:text-primary transition-colors">{preset.label}</h3>
                <Badge variant={preset.severity === 'CRITICAL' ? 'destructive' : 'secondary'} className="text-[10px]">
                  {preset.severity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 mb-4">{preset.description}</p>
              <Button size="sm" variant="outline" className="w-full border-primary/50 text-primary hover:bg-primary/10">
                <PlayCircle className="h-4 w-4 mr-2" /> Load Preset
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Center - Visualization */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between px-1">
          <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Simulation Output</div>
          <AiBadge />
        </div>
        <Card className="flex-1 bg-card/30 border-border flex items-center justify-center flex-col gap-4 text-muted-foreground">
          <ShieldAlert className="h-16 w-16 text-muted" />
          <p>Load a scenario to view 30-day simulated projection.</p>
        </Card>
      </div>

      {/* Right Rail - History & Actions */}
      <div className="w-[320px] flex flex-col gap-4 shrink-0 overflow-y-auto">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">Saved Runs</div>
        
        {scenariosLoading ? <Skeleton className="h-48" /> : scenarios?.map(scenario => (
          <Card key={scenario.id} className="bg-card/50 border-border">
            <CardContent className="p-3">
              <div className="font-medium text-sm mb-1">{scenario.name}</div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{new Date(scenario.createdAt).toLocaleDateString()}</span>
                <span className="uppercase">{scenario.status}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {scenarios?.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">No saved scenarios</div>}
      </div>
    </div>
  );
}
