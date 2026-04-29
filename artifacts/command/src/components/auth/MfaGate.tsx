import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  startMfaEnrollment,
  useVerifyMfaEnrollment,
  useVerifyMfa,
  getGetCurrentAuthUserQueryKey,
  type AuthUserEnvelope,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, ShieldCheck, Smartphone } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/+$/, "") || ""}/api`;

function logoutUrl(): string {
  return `${API_BASE}/logout`;
}

function ChromeShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <Card className="w-full max-w-lg bg-card/70 border-border">
        <CardContent className="p-8">{children}</CardContent>
      </Card>
    </div>
  );
}

function EnrollScreen({ onDone }: { onDone: () => void }) {
  // We bypass the orval-generated mutation hook here because its type
  // narrowing (UseMutationResult is a discriminated union in react-query v5)
  // makes branch-specific access to `mutate` painful in a screen that needs
  // to render different states.
  const [enrollment, setEnrollment] =
    useState<Awaited<ReturnType<typeof startMfaEnrollment>> | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const verify = useVerifyMfaEnrollment();
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beginEnrollment = useCallback(async () => {
    setEnrollError(null);
    try {
      const data = await startMfaEnrollment();
      setEnrollment(data);
    } catch {
      setEnrollError("Failed to start MFA enrollment.");
    }
  }, []);

  useEffect(() => {
    void beginEnrollment();
  }, [beginEnrollment]);

  if (recoveryCodes) {
    return (
      <ChromeShell>
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-lg font-bold uppercase tracking-wider">
                Save Your Recovery Codes
              </h1>
              <p className="text-xs text-muted-foreground">
                Store these somewhere safe. Each code works once if you lose
                your authenticator.
              </p>
            </div>
          </div>
          <pre className="bg-secondary/40 rounded-md p-3 font-mono text-xs grid grid-cols-2 gap-1">
            {recoveryCodes.map((c) => (
              <code key={c} className="select-all">
                {c}
              </code>
            ))}
          </pre>
          <Button className="w-full" onClick={onDone} data-testid="button-mfa-continue">
            I've saved them — continue
          </Button>
        </div>
      </ChromeShell>
    );
  }

  if (enrollError) {
    return (
      <ChromeShell>
        <div className="space-y-3 text-sm">
          <p className="text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {enrollError}
          </p>
          <Button onClick={() => void beginEnrollment()} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      </ChromeShell>
    );
  }

  if (!enrollment) {
    return (
      <ChromeShell>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating enrollment…
        </div>
      </ChromeShell>
    );
  }

  return (
    <ChromeShell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Smartphone className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-lg font-bold uppercase tracking-wider">
              Set Up Microsoft Authenticator
            </h1>
            <p className="text-xs text-muted-foreground">
              Scan with Microsoft Authenticator (or any TOTP app), then enter
              the 6-digit code to confirm.
            </p>
          </div>
        </div>
        <div className="flex justify-center bg-white rounded-md p-3">
          <div
            // The QR is a server-rendered SVG; safe to inject.
            dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
            data-testid="mfa-qr"
          />
        </div>
        <div className="text-xs text-muted-foreground text-center font-mono break-all">
          {enrollment.account} · {enrollment.issuer}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Can't scan? Show secret</summary>
          <code className="block mt-1 select-all bg-secondary/40 rounded p-2 font-mono">
            {enrollment.secret}
          </code>
        </details>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            verify.mutate(
              { data: { code: code.trim() } },
              {
                onSuccess: (resp) => {
                  setRecoveryCodes(resp.recoveryCodes);
                },
                onError: () => setError("That code didn't match. Try again."),
              },
            );
          }}
        >
          <Label htmlFor="mfa-enroll-code">6-digit code</Label>
          <Input
            id="mfa-enroll-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            data-testid="input-mfa-enroll-code"
          />
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={verify.isPending || code.trim().length < 6}
            data-testid="button-mfa-enroll-verify"
          >
            {verify.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Verify & enable MFA"
            )}
          </Button>
        </form>
      </div>
    </ChromeShell>
  );
}

function VerifyScreen({ onDone }: { onDone: () => void }) {
  const verify = useVerifyMfa();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <ChromeShell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-lg font-bold uppercase tracking-wider">
              Authenticator Required
            </h1>
            <p className="text-xs text-muted-foreground">
              Enter the current 6-digit code from Microsoft Authenticator, or a
              one-time recovery code.
            </p>
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            verify.mutate(
              { data: { code: code.trim() } },
              {
                onSuccess: onDone,
                onError: (err) => {
                  const status = (err as { status?: number })?.status;
                  setError(
                    status === 429
                      ? "Too many failed attempts — try again shortly."
                      : "That code didn't match. Try again.",
                  );
                },
              },
            );
          }}
        >
          <Label htmlFor="mfa-verify-code">Code</Label>
          <Input
            id="mfa-verify-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456 or recovery code"
            data-testid="input-mfa-verify-code"
            autoFocus
          />
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={verify.isPending || code.trim().length < 6}
            data-testid="button-mfa-verify"
          >
            {verify.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Continue"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => {
              window.location.href = logoutUrl();
            }}
          >
            Sign out
          </Button>
        </form>
      </div>
    </ChromeShell>
  );
}

export default function MfaGate({
  envelope,
  children,
}: {
  envelope: AuthUserEnvelope;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { mfa } = envelope;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetCurrentAuthUserQueryKey() });

  if (!mfa.enrolled) return <EnrollScreen onDone={refresh} />;
  if (!mfa.verified) return <VerifyScreen onDone={refresh} />;
  return <>{children}</>;
}
