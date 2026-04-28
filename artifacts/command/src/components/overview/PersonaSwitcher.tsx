import React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERSONA_OPTIONS, type Persona } from "./persona";

export function PersonaSwitcher({
  value,
  onChange,
}: {
  value: Persona;
  onChange: (p: Persona) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as Persona)}
      className="w-full"
    >
      <TabsList className="bg-muted/40 border border-border/60">
        {PERSONA_OPTIONS.map((opt) => (
          <TabsTrigger
            key={opt.id}
            value={opt.id}
            className="text-xs uppercase tracking-wider data-[state=active]:bg-background data-[state=active]:text-primary"
          >
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
