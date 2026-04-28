import React from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  useListNodes,
  useListItems,
  useListSuppliers,
  getListNodesQueryKey,
  getListItemsQueryKey,
  getListSuppliersQueryKey,
} from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Map as MapIcon,
  ListChecks,
  Settings,
  MessageSquare,
  Database,
  Building2,
  Truck,
  Package,
  Activity,
  ScrollText,
} from "lucide-react";

// Page entries are static — every operator can navigate to these
// regardless of role/persona. The icons match the sidebar so the
// palette feels like a faster way to do the same trip.
const PAGES: Array<{ label: string; href: string; icon: React.ReactNode }> = [
  // Hrefs must match the wouter Route paths in App.tsx exactly.
  // Network Map is /network (not /network-map) and Data Admin is /data
  // (not /data-admin) — getting these wrong silently lands on NotFound.
  { label: "Command Overview", href: "/", icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: "Network Map", href: "/network", icon: <MapIcon className="h-4 w-4" /> },
  { label: "Locations", href: "/locations", icon: <Building2 className="h-4 w-4" /> },
  { label: "Suppliers", href: "/suppliers", icon: <Truck className="h-4 w-4" /> },
  { label: "Orders", href: "/orders", icon: <ScrollText className="h-4 w-4" /> },
  { label: "Scenarios", href: "/scenarios", icon: <Activity className="h-4 w-4" /> },
  { label: "Copilot", href: "/copilot", icon: <MessageSquare className="h-4 w-4" /> },
  { label: "Data Admin", href: "/data", icon: <Database className="h-4 w-4" /> },
  { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" /> },
];

const RESULT_LIMIT = 6;

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setLocation] = useLocation();

  // Pull the network entities so the palette can jump straight to a
  // specific site / item / supplier. We let cmdk do the actual fuzzy
  // filtering — these queries pull the full lists once (they're small
  // for INDOPACOM) and cmdk filters them on every keystroke.
  const { data: nodes = [] } = useListNodes({
    query: { queryKey: getListNodesQueryKey(), enabled: open },
  });
  const { data: items = [] } = useListItems({
    query: { queryKey: getListItemsQueryKey(), enabled: open },
  });
  const { data: suppliers = [] } = useListSuppliers({
    query: { queryKey: getListSuppliersQueryKey(), enabled: open },
  });

  const go = (href: string) => {
    onOpenChange(false);
    setLocation(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search sites, items, suppliers, and pages…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.href}
              value={`page ${p.label}`}
              onSelect={() => go(p.href)}
              className="cursor-pointer"
            >
              <span className="text-muted-foreground mr-2">{p.icon}</span>
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sites">
          {nodes.slice(0, 50).map((n: any) => (
            <CommandItem
              key={`node-${n.id}`}
              value={`site ${n.name} ${n.type ?? ""} ${n.id}`}
              onSelect={() => go(`/sites/${n.id}`)}
              className="cursor-pointer"
            >
              <Building2 className="h-4 w-4 text-muted-foreground mr-2" />
              <span className="flex-1">{n.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {n.type ?? "site"}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Items">
          {items.slice(0, 50).map((it: any) => (
            <CommandItem
              key={`item-${it.id}`}
              value={`item ${it.name} ${it.category ?? ""} ${it.id}`}
              onSelect={() => go(`/items/${it.id}`)}
              className="cursor-pointer"
            >
              <Package className="h-4 w-4 text-muted-foreground mr-2" />
              <span className="flex-1">{it.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {it.category ?? "item"}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Suppliers">
          {suppliers.slice(0, 50).map((s: any) => (
            <CommandItem
              key={`supplier-${s.id}`}
              value={`supplier ${s.name} ${s.channel ?? ""} ${s.id}`}
              onSelect={() => go(`/suppliers`)}
              className="cursor-pointer"
            >
              <Truck className="h-4 w-4 text-muted-foreground mr-2" />
              <span className="flex-1">{s.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.channel ?? "supplier"}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// Hook that toggles palette visibility on Cmd+K / Ctrl+K. Returns
// the controlled state so the trigger button can also open it.
export function useSearchPalette() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

// Suppress unused import warning when palette is not yet wired in
// some persona pages.
void RESULT_LIMIT;
void ListChecks;
