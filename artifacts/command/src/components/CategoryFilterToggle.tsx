import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type { CategoryFilter } from "@/lib/format";

/**
 * Shared "Blood / Medical / Both" toggle used wherever an inventory-style
 * surface needs to focus on one supply class. Centralising the look,
 * behaviour and data-testids keeps the casualty planner, site detail
 * inventory tab, recommendations rail, and locations page in lockstep so
 * operators can move between them without re-learning the control.
 */
export function CategoryFilterToggle({
  value,
  onChange,
  testId,
  size = "md",
}: {
  value: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
  /** Optional suffix appended to the data-testid so multiple toggles can
   *  coexist on a single page (e.g. inventory + recommendations). */
  testId?: string;
  size?: "sm" | "md";
}) {
  const cls =
    size === "sm" ? "bg-secondary/40 rounded-md h-7" : "bg-secondary/40 rounded-md";
  const itemCls = size === "sm" ? "h-7 px-2 text-[11px]" : undefined;
  const suffix = testId ? `-${testId}` : "";
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as CategoryFilter)}
      className={cls}
      data-testid={`toggle-category${suffix}`}
    >
      <ToggleGroupItem
        value="blood"
        className={itemCls}
        data-testid={`toggle-blood${suffix}`}
      >
        Blood
      </ToggleGroupItem>
      <ToggleGroupItem
        value="medical"
        className={itemCls}
        data-testid={`toggle-medical${suffix}`}
      >
        Medical
      </ToggleGroupItem>
      <ToggleGroupItem
        value="both"
        className={itemCls}
        data-testid={`toggle-both${suffix}`}
      >
        Both
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
