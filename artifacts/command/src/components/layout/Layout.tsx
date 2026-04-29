import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, Map as MapIcon, Box, ShoppingCart, PlayCircle, 
  MessageSquare, Database, Settings, UserCircle, Search,
  Building2, Truck, Tag as TagIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RoleBadge from "@/components/RoleBadge";
import AlertsRail from "@/components/AlertsRail";
import LiveClock from "@/components/layout/LiveClock";
import FpconPill from "@/components/layout/FpconPill";
import { SearchPalette, useSearchPalette } from "@/components/SearchPalette";
import { useGetProfile } from "@workspace/api-client-react";
import dhaSeal from "@assets/Seal_of_War_Health_Agency_1777349167048.png";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const palette = useSearchPalette();
  const { data: profile } = useGetProfile();

  // Per-item accent colors. Each row owns a distinct hue so users can scan
  // the rail at a glance and immediately know where they are. Class strings
  // are written as full literals (no string interpolation) so Tailwind's JIT
  // can see them at build time.
  type NavColor = {
    iconActive: string;
    iconInactive: string;
    iconHover: string;
    activeBg: string;
    activeText: string;
    hoverBg: string;
    hoverText: string;
    ring: string;
  };
  const NAV_COLORS: Record<string, NavColor> = {
    "/": {
      iconActive: "text-teal-300",
      iconInactive: "text-teal-400/60",
      iconHover: "group-hover:text-teal-200",
      activeBg: "bg-teal-400/15",
      activeText: "text-teal-100",
      hoverBg: "hover:bg-teal-400/10",
      hoverText: "hover:text-teal-100",
      ring: "focus-visible:ring-teal-400",
    },
    "/network": {
      iconActive: "text-sky-300",
      iconInactive: "text-sky-400/60",
      iconHover: "group-hover:text-sky-200",
      activeBg: "bg-sky-400/15",
      activeText: "text-sky-100",
      hoverBg: "hover:bg-sky-400/10",
      hoverText: "hover:text-sky-100",
      ring: "focus-visible:ring-sky-400",
    },
    "/locations": {
      iconActive: "text-emerald-300",
      iconInactive: "text-emerald-400/60",
      iconHover: "group-hover:text-emerald-200",
      activeBg: "bg-emerald-400/15",
      activeText: "text-emerald-100",
      hoverBg: "hover:bg-emerald-400/10",
      hoverText: "hover:text-emerald-100",
      ring: "focus-visible:ring-emerald-400",
    },
    "/suppliers": {
      iconActive: "text-amber-300",
      iconInactive: "text-amber-400/65",
      iconHover: "group-hover:text-amber-200",
      activeBg: "bg-amber-400/15",
      activeText: "text-amber-100",
      hoverBg: "hover:bg-amber-400/10",
      hoverText: "hover:text-amber-100",
      ring: "focus-visible:ring-amber-400",
    },
    "/orders": {
      iconActive: "text-rose-300",
      iconInactive: "text-rose-400/60",
      iconHover: "group-hover:text-rose-200",
      activeBg: "bg-rose-400/15",
      activeText: "text-rose-100",
      hoverBg: "hover:bg-rose-400/10",
      hoverText: "hover:text-rose-100",
      ring: "focus-visible:ring-rose-400",
    },
    "/casualty": {
      iconActive: "text-red-300",
      iconInactive: "text-red-400/65",
      iconHover: "group-hover:text-red-200",
      activeBg: "bg-red-400/15",
      activeText: "text-red-100",
      hoverBg: "hover:bg-red-400/10",
      hoverText: "hover:text-red-100",
      ring: "focus-visible:ring-red-400",
    },
    "/scenarios": {
      iconActive: "text-violet-300",
      iconInactive: "text-violet-400/60",
      iconHover: "group-hover:text-violet-200",
      activeBg: "bg-violet-400/15",
      activeText: "text-violet-100",
      hoverBg: "hover:bg-violet-400/10",
      hoverText: "hover:text-violet-100",
      ring: "focus-visible:ring-violet-400",
    },
    "/copilot": {
      iconActive: "text-blue-300",
      iconInactive: "text-blue-400/60",
      iconHover: "group-hover:text-blue-200",
      activeBg: "bg-blue-400/15",
      activeText: "text-blue-100",
      hoverBg: "hover:bg-blue-400/10",
      hoverText: "hover:text-blue-100",
      ring: "focus-visible:ring-blue-400",
    },
    "/data": {
      iconActive: "text-lime-300",
      iconInactive: "text-lime-400/65",
      iconHover: "group-hover:text-lime-200",
      activeBg: "bg-lime-400/15",
      activeText: "text-lime-100",
      hoverBg: "hover:bg-lime-400/10",
      hoverText: "hover:text-lime-100",
      ring: "focus-visible:ring-lime-400",
    },
    "/settings": {
      iconActive: "text-orange-300",
      iconInactive: "text-orange-400/65",
      iconHover: "group-hover:text-orange-200",
      activeBg: "bg-orange-400/15",
      activeText: "text-orange-100",
      hoverBg: "hover:bg-orange-400/10",
      hoverText: "hover:text-orange-100",
      ring: "focus-visible:ring-orange-400",
    },
    "/profile": {
      iconActive: "text-indigo-300",
      iconInactive: "text-indigo-400/65",
      iconHover: "group-hover:text-indigo-200",
      activeBg: "bg-indigo-400/15",
      activeText: "text-indigo-100",
      hoverBg: "hover:bg-indigo-400/10",
      hoverText: "hover:text-indigo-100",
      ring: "focus-visible:ring-indigo-400",
    },
  };

  const navItems: Array<{
    href: string;
    label: string;
    icon: typeof Activity;
    matches?: (path: string) => boolean;
  }> = [
    { href: "/", label: "Overview", icon: Activity, matches: (p) => p === "/" },
    { href: "/network", label: "Network", icon: MapIcon },
    {
      href: "/locations",
      label: "Locations",
      icon: Building2,
      matches: (p) => p === "/locations" || p.startsWith("/locations/") || p.startsWith("/sites/"),
    },
    {
      href: "/suppliers",
      label: "Suppliers",
      icon: Truck,
      matches: (p) => p === "/suppliers" || p.startsWith("/suppliers/"),
    },
    { href: "/orders", label: "Orders", icon: ShoppingCart },
    { href: "/casualty", label: "Casualty Planner", icon: Activity },
    { href: "/scenarios", label: "Scenarios", icon: PlayCircle },
    { href: "/tags", label: "Tags", icon: TagIcon, matches: (p) => p === "/tags" || p.startsWith("/tags/") },
    { href: "/copilot", label: "Copilot", icon: MessageSquare },
  ];

  const bottomItems = [
    { href: "/data", label: "Data", icon: Database },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/profile", label: "Profile", icon: UserCircle },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-16 md:w-64 border-r border-border bg-sidebar flex flex-col justify-between transition-all shrink-0">
        <div>
          <Link
            href="/"
            aria-label="Go to Overview"
            data-testid="link-sidebar-home"
            className="h-16 flex items-center justify-center md:justify-start md:px-3 border-b border-border shrink-0 gap-2.5 cursor-pointer hover:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors"
          >
            <img
              src={dhaSeal}
              alt="Defense Health Agency seal"
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_6px_rgba(76,196,196,0.25)]"
              draggable={false}
            />
            <div className="hidden md:flex flex-col leading-tight min-w-0">
              <span className="font-bold text-primary tracking-widest text-xs uppercase truncate">
                DHA: IRON-VEIN
              </span>
              <span
                className="text-[8.5px] text-muted-foreground/80 tracking-wide leading-snug truncate"
                title="INDOPACOM Resilient Operational Network for Vital Expeditionary Inventory Nodes"
              >
                INDOPACOM Resilient Operational Network
              </span>
              <span
                className="text-[8.5px] text-muted-foreground/80 tracking-wide leading-snug truncate"
                title="INDOPACOM Resilient Operational Network for Vital Expeditionary Inventory Nodes"
              >
                for Vital Expeditionary Inventory Nodes
              </span>
            </div>
          </Link>
          <nav className="flex flex-col gap-1 p-2 mt-4">
            {navItems.map((item) => {
              const active = item.matches
                ? item.matches(location)
                : location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const c = NAV_COLORS[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${c.ring} ${
                    active
                      ? `${c.activeBg} ${c.activeText}`
                      : `text-muted-foreground ${c.hoverBg} ${c.hoverText}`
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 shrink-0 transition-colors ${
                      active ? c.iconActive : `${c.iconInactive} ${c.iconHover}`
                    }`}
                  />
                  <span className="hidden md:inline text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-2 border-t border-border flex flex-col gap-1 shrink-0">
          {bottomItems.map((item) => {
            const active = location === item.href;
            const c = NAV_COLORS[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 px-3 py-2 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${c.ring} ${
                  active
                    ? `${c.activeBg} ${c.activeText}`
                    : `text-muted-foreground ${c.hoverBg} ${c.hoverText}`
                }`}
              >
                <item.icon
                  className={`h-5 w-5 shrink-0 transition-colors ${
                    active ? c.iconActive : `${c.iconInactive} ${c.iconHover}`
                  }`}
                />
                <span className="hidden md:inline text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
        {/* Top Header */}
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-4 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex items-center gap-2 border-border bg-secondary/50 hover:bg-secondary"
              onClick={() => palette.setOpen(true)}
              data-testid="open-search-palette"
            >
              <Search className="h-4 w-4" />
              <span className="text-muted-foreground">Search</span>
              <kbd className="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground/80">
                ⌘K
              </kbd>
            </Button>
            <FpconPill />
          </div>
          <div className="flex items-center gap-4">
            <RoleBadge />
            <div className="h-6 w-px bg-border mx-1"></div>
            <LiveClock />
            <AlertsRail />
            <div className="h-6 w-px bg-border"></div>
            <Link href="/profile" className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors">
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center border border-border">
                <UserCircle className="h-5 w-5" />
              </div>
              <span className="hidden sm:inline">{profile?.name || "Loading..."}</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden relative">
          {children}
        </main>
      </div>

      {/* Global Cmd+K palette — mounted once per layout so the keyboard
          shortcut works on every page. */}
      <SearchPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}
