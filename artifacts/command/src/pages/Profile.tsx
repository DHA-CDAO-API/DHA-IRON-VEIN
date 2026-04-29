import React, { useEffect } from 'react';
import { useGetProfile, useUpdateProfile, useListRoles, getGetProfileQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserCircle, Shield, Map, Activity, Database, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

function downloadRecoveryCodes(codes: string[]) {
  const body = [
    'DHA IRONVEIN — MFA Recovery Codes',
    `Generated: ${new Date().toISOString()}`,
    'Each code may be used ONCE. Store offline (e.g. printed copy).',
    '',
    ...codes,
    '',
  ].join('\n');
  const blob = new Blob([body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ironvein-recovery-codes-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function MfaPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useGetMfaStatus();
  const startEnroll = useStartMfaEnrollment();
  const verifyEnroll = useVerifyMfaEnrollment();
  const regenerate = useRegenerateMfaRecoveryCodes();
  const reset = useResetMfa();

  const [enrollUi, setEnrollUi] = useState<{ qrSvg: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);

  const enrolled = !!status?.enrolled;
  const verified = !!status?.verified;

  const beginEnroll = () => {
    startEnroll.mutate(undefined, {
      onSuccess: (data: any) => {
        setEnrollUi({ qrSvg: data.qrSvg, secret: data.secret });
        setShownCodes(null);
      },
      onError: () => toast({ title: 'Failed to start MFA enrollment', variant: 'destructive' }),
    });
  };

  const completeEnroll = () => {
    verifyEnroll.mutate(
      { data: { code } },
      {
        onSuccess: (data: any) => {
          setEnrollUi(null);
          setCode('');
          setShownCodes(data.recoveryCodes);
          queryClient.invalidateQueries({ queryKey: getGetMfaStatusQueryKey() });
          toast({ title: 'Authenticator enrolled', description: 'Save your recovery codes.' });
        },
        onError: () => toast({ title: 'Code rejected', variant: 'destructive' }),
      },
    );
  };

  const onRegenerate = () => {
    regenerate.mutate(undefined, {
      onSuccess: (data: any) => {
        setShownCodes(data.recoveryCodes);
        toast({ title: 'Recovery codes regenerated' });
      },
      onError: () => toast({ title: 'Regeneration failed', variant: 'destructive' }),
    });
  };

  const onReset = () => {
    if (!confirm('Reset authenticator? You will need to re-enroll on next sign-in.')) return;
    reset.mutate(
      { data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMfaStatusQueryKey() });
          setEnrollUi(null);
          setShownCodes(null);
          toast({ title: 'MFA reset', description: 'Re-enroll your authenticator now.' });
        },
        onError: () => toast({ title: 'Reset failed (commander role + verified MFA required)', variant: 'destructive' }),
      },
    );
  };

  return (
    <Card className="bg-card/50 border-border" data-testid="mfa-panel">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> Multi-Factor Authentication
          </h2>
          <span
            className={`text-xs uppercase tracking-wider px-2 py-1 rounded flex items-center gap-1 ${
              enrolled && verified
                ? 'bg-emerald-500/10 text-emerald-400'
                : enrolled
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-red-500/10 text-red-400'
            }`}
            data-testid="mfa-status-badge"
          >
            {enrolled && verified ? (
              <>
                <ShieldCheck className="h-3 w-3" /> Enrolled · Verified
              </>
            ) : enrolled ? (
              <>
                <ShieldAlert className="h-3 w-3" /> Enrolled · Unverified
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" /> Not enrolled
              </>
            )}
          </span>
        </div>

        {!enrolled && !enrollUi && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Pair Microsoft Authenticator (or any TOTP app) to satisfy the IRONVEIN MFA gate.
            </p>
            <Button onClick={beginEnroll} disabled={startEnroll.isPending} data-testid="button-mfa-enroll">
              Enroll Authenticator
            </Button>
          </div>
        )}

        {enrollUi && (
          <div className="space-y-3" data-testid="mfa-enroll-ui">
            <p className="text-sm text-muted-foreground">
              Scan the QR with your authenticator app, then enter the 6-digit code below.
            </p>
            <div
              className="bg-white p-3 rounded inline-block"
              dangerouslySetInnerHTML={{ __html: enrollUi.qrSvg }}
            />
            <div className="text-xs font-mono break-all bg-secondary/30 p-2 rounded">
              Secret: {enrollUi.secret}
            </div>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                maxLength={8}
                data-testid="input-mfa-enroll-code"
              />
              <Button onClick={completeEnroll} disabled={verifyEnroll.isPending || code.length < 6}>
                Verify
              </Button>
            </div>
          </div>
        )}

        {enrolled && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRegenerate}
              disabled={regenerate.isPending || !verified}
              data-testid="button-mfa-regenerate"
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Regenerate Recovery Codes
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onReset}
              disabled={reset.isPending}
              data-testid="button-mfa-reset"
            >
              <ShieldAlert className="h-3 w-3 mr-1" /> Reset Authenticator
            </Button>
            {!verified && (
              <span className="text-xs text-amber-400 self-center">
                Recovery code regeneration requires a freshly verified MFA challenge.
              </span>
            )}
          </div>
        )}

        {shownCodes && (
          <div className="border border-amber-500/30 rounded p-3 bg-amber-500/5 space-y-2" data-testid="mfa-recovery-codes">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-amber-400 font-bold">
                Recovery Codes — shown ONCE
              </p>
              <Button size="sm" variant="outline" onClick={() => downloadRecoveryCodes(shownCodes)}>
                <Download className="h-3 w-3 mr-1" /> Download
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs">
              {shownCodes.map((c) => (
                <div key={c} className="bg-background/50 px-2 py-1 rounded">{c}</div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Profile() {
  const { data: profile, isLoading } = useGetProfile();
  const { data: roles } = useListRoles();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      name: '',
      base: '',
      role: ''
    }
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name,
        base: profile.base,
        role: profile.role
      });
    }
  }, [profile, form]);

  const handleRoleSelect = (roleId: string) => {
    form.setValue('role', roleId);
    updateProfile.mutate({ data: { role: roleId } }, {
      onSuccess: () => {
        toast({ title: 'Role Switched', description: 'Dashboard reloaded with new perspective.' });
        queryClient.invalidateQueries(); // Invalidate all to refresh view
      }
    });
  };

  const onSubmit = (data: any) => {
    updateProfile.mutate({ data: { name: data.name, base: data.base } }, {
      onSuccess: () => {
        toast({ title: 'Profile Updated' });
        queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      }
    });
  };

  if (isLoading) return <div className="p-6">Loading...</div>;

  const roleIcons: Record<string, any> = {
    commander: Shield,
    logistician: Map,
    medical_planner: Activity,
    analyst: Database
  };

  return (
    <div className="h-full flex flex-col p-6 bg-background overflow-y-auto max-w-5xl mx-auto w-full">
      <h1 className="text-2xl font-bold uppercase tracking-wider mb-8">Personnel Profile</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Col - Info */}
        <Card className="bg-card/50 border-border h-fit">
          <CardContent className="p-6 flex flex-col items-center">
            <UserCircle className="h-24 w-24 text-muted-foreground mb-4" />
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input {...form.register('name')} className="bg-background/50 text-center" />
              </div>
              <div className="space-y-2">
                <Label>Theater Assignment / Base</Label>
                <Input {...form.register('base')} className="bg-background/50 text-center" />
              </div>
              <Button type="submit" className="w-full" disabled={updateProfile.isPending}>
                Update Info
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right Col - Role Switcher */}
        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Active Perspective (Role)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {roles?.map(role => {
              const Icon = roleIcons[role.id] || UserCircle;
              const isActive = form.watch('role') === role.id;
              
              return (
                <Card 
                  key={role.id} 
                  className={`cursor-pointer transition-all duration-200 border-2 ${isActive ? 'bg-primary/10 border-primary shadow-[0_0_15px_rgba(0,255,255,0.1)]' : 'bg-card/50 border-border hover:border-primary/50'}`}
                  onClick={() => !isActive && handleRoleSelect(role.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className={`p-2 rounded-lg ${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      {isActive && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <h3 className="font-bold text-lg mb-1">{role.label}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{role.description}</p>
                    <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-1">
                      {role.focus.map((f, i) => (
                        <span key={i} className="text-[10px] uppercase tracking-wider bg-secondary px-2 py-0.5 rounded text-muted-foreground">{f}</span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
