import { type ReactNode } from "react";
import {
  useGetCurrentAuthUser,
  getGetCurrentAuthUserQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Shield } from "lucide-react";
import dhaSeal from "@assets/Seal_of_War_Health_Agency_1777349167048.png";
import MfaGate from "./MfaGate";
import { IronVeinBrand } from "@/components/brand/IronVeinBrand";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/+$/, "") || ""}/api`;

function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `${API_BASE}/login?returnTo=${encodeURIComponent(here)}`;
}

function SignInScreen() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <Card className="w-full max-w-md bg-card/70 border-border">
        <CardContent className="p-8 flex flex-col items-center gap-6 text-center">
          <img
            src={dhaSeal}
            alt="Defense Health Agency seal"
            className="h-20 w-20 object-contain drop-shadow-[0_0_8px_rgba(76,196,196,0.35)]"
            draggable={false}
          />
          <div className="space-y-2">
            <h1 className="text-xl font-bold uppercase tracking-widest text-primary">
              DHA: IRON-VEIN
            </h1>
            <IronVeinBrand className="block text-[11px] uppercase tracking-wide text-muted-foreground leading-snug" />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This system handles operational logistics data restricted to
            mission-essential use only. Sign in with your Replit identity and
            complete the authenticator challenge to continue.
          </p>
          <Button
            className="w-full"
            onClick={() => {
              window.location.href = loginUrl();
            }}
            data-testid="button-sign-in"
          >
            <Shield className="h-4 w-4 mr-2" /> Sign in
          </Button>
          <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            Unauthorized access is prohibited and audited.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function FullscreenSpinner() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useGetCurrentAuthUser({
    query: {
      // The envelope changes when login/logout/MFA happens — don't cache
      // forever. A short stale window is plenty for our purposes.
      queryKey: getGetCurrentAuthUserQueryKey(),
      staleTime: 30_000,
      retry: false,
    },
  });

  if (isLoading) return <FullscreenSpinner />;
  if (isError || !data?.user) return <SignInScreen />;

  return <MfaGate envelope={data}>{children}</MfaGate>;
}
