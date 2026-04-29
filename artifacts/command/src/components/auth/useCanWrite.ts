import { useGetCurrentAuthUser } from "@workspace/api-client-react";

const WRITE_ROLES = new Set(["commander", "logistician"]);

/**
 * Indicates whether the current user is allowed to issue write actions
 * (create / patch / promote orders, planner runs, etc.).  Mirrors the
 * server-side `requireRole("commander", "logistician")` middleware so the
 * UI hides or disables actions the API would reject anyway.
 */
export function useCanWrite(): {
  canWrite: boolean;
  role: string | null;
  reason: string;
} {
  const { data } = useGetCurrentAuthUser();
  const role = data?.user?.role ?? null;
  const canWrite = role ? WRITE_ROLES.has(role) : false;
  return {
    canWrite,
    role,
    reason: canWrite
      ? ""
      : "Read-only role — only Commander or Logistician may submit changes.",
  };
}
