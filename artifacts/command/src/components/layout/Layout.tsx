import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, Map as MapIcon, Box, ShoppingCart, PlayCircle, 
  MessageSquare, Database, Settings, UserCircle, Search,
  Building2, Truck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RoleBadge from "@/components/RoleBadge";
import AlertsRail from "@/components/AlertsRail";
import LiveClock from "@/components/layout/LiveClock";
import { SearchPalette, useSearchPalette } from "@/components/SearchPalette";
import { useGetProfile } from "@workspace/api-client-react";
import dhaSeal from "@assets/Seal_of_War_Health_Agency_1777349167048.png";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const palette = useSearchPalette();
  const { data: profile } = useGetProfile();

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
    { href: "/scenarios", label: "Scenarios", icon: PlayCircle },
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
              return (
                <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className="hidden md:inline text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-2 border-t border-border flex flex-col gap-1 shrink-0">
          {bottomItems.map((item) => {
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                <item.icon className="h-5 w-5 shrink-0" />
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
            <div className="px-2 py-1 bg-destructive/20 border border-destructive/50 text-destructive text-xs font-mono rounded font-bold tracking-wider animate-pulse">
              OPCON: HEIGHTENED
            </div>
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
