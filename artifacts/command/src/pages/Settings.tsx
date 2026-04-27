import React, { useEffect } from 'react';
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Save, Settings2, Shield, Network } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      provider: 'openai',
      model: '',
      warnDays: 7,
      criticalDays: 3,
      dmlssCompatible: false,
      operationalState: 'PEACETIME'
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        provider: settings.provider,
        model: settings.model,
        warnDays: settings.riskThresholds.warnDays,
        criticalDays: settings.riskThresholds.criticalDays,
        dmlssCompatible: settings.dmlssCompatible,
        operationalState: settings.operationalState || 'PEACETIME'
      });
    }
  }, [settings, form]);

  const onSubmit = (data: any) => {
    updateSettings.mutate({ 
      data: {
        provider: data.provider,
        model: data.model,
        warnDays: data.warnDays,
        criticalDays: data.criticalDays,
        dmlssCompatible: data.dmlssCompatible,
        operationalState: data.operationalState
      }
    }, {
      onSuccess: () => {
        toast({ title: 'Settings Saved', description: 'Theater settings updated successfully.' });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      }
    });
  };

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="h-full flex flex-col p-6 bg-background overflow-y-auto">
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <Settings2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold uppercase tracking-wider">Theater Settings</h1>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-4xl space-y-6">
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-lg">AI Provider Configuration</CardTitle>
            <CardDescription>Model used for Copilot and Scenario generations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Provider</Label>
              <RadioGroup 
                value={form.watch('provider')} 
                onValueChange={v => form.setValue('provider', v)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2 border border-border rounded-md p-3 flex-1 bg-background/50">
                  <RadioGroupItem value="openai" id="openai" />
                  <Label htmlFor="openai" className="cursor-pointer">OpenAI</Label>
                </div>
                <div className="flex items-center space-x-2 border border-border rounded-md p-3 flex-1 bg-background/50">
                  <RadioGroupItem value="anthropic" id="anthropic" />
                  <Label htmlFor="anthropic" className="cursor-pointer">Anthropic</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Model Override (Optional)</Label>
              <Input {...form.register('model')} placeholder="e.g. gpt-4o" className="bg-background/50" />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Risk Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between">
                  <Label>Warning Threshold (DOS)</Label>
                  <span className="font-mono text-amber-500">{form.watch('warnDays')} days</span>
                </div>
                <Slider 
                  value={[form.watch('warnDays')]} 
                  onValueChange={([v]) => form.setValue('warnDays', v)}
                  max={14} step={1}
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <Label>Critical Threshold (DOS)</Label>
                  <span className="font-mono text-destructive">{form.watch('criticalDays')} days</span>
                </div>
                <Slider 
                  value={[form.watch('criticalDays')]} 
                  onValueChange={([v]) => form.setValue('criticalDays', v)}
                  max={7} step={1}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Network className="h-5 w-5 text-primary" /> External Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>DMLSS Compatibility Mode</Label>
                  <div className="text-sm text-muted-foreground">Map to legacy DMLSS schemas</div>
                </div>
                <Switch 
                  checked={form.watch('dmlssCompatible')}
                  onCheckedChange={v => form.setValue('dmlssCompatible', v)}
                />
              </div>
              <div className="space-y-2">
                <Label>Operational Profile</Label>
                <Select value={form.watch('operationalState')} onValueChange={v => form.setValue('operationalState', v)}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PEACETIME">Peacetime (Baseline)</SelectItem>
                    <SelectItem value="HEIGHTENED">Heightened (1.5x Demand)</SelectItem>
                    <SelectItem value="CONFLICT">Conflict (3.0x Demand)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={updateSettings.isPending} className="px-8">
            <Save className="h-4 w-4 mr-2" />
            Save Configuration
          </Button>
        </div>
      </form>
    </div>
  );
}

