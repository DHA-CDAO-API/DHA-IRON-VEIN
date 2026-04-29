import type { ReactNode } from "react";

const Cap = ({ children }: { children: ReactNode }) => (
  <b className="text-primary font-black">{children}</b>
);

export function IronVeinBrand({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <Cap>I</Cap>NDOPACOM <Cap>R</Cap>esilient <Cap>O</Cap>perational{" "}
      <Cap>N</Cap>etwork for <Cap>V</Cap>ital <Cap>E</Cap>xpeditionary{" "}
      <Cap>I</Cap>nventory <Cap>N</Cap>odes
    </span>
  );
}

export function IronVeinAcronym({ className = "" }: { className?: string }) {
  return <span className={`text-primary font-bold ${className}`}>IRONVEIN</span>;
}

export const IRONVEIN_FULL_TEXT =
  "INDOPACOM Resilient Operational Network for Vital Expeditionary Inventory Nodes";
