import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, Map as MapIcon, Box, ShoppingCart, PlayCircle, 
  MessageSquare, Database, Settings, UserCircle, Search, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RoleBadge from "@/components/RoleBadge";
import AlertsRail from "@/components/AlertsRail";
import { useGetProfile } from "@workspace/api-client-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: profile } = useGetProfile();

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/network", label: "Network", icon: MapIcon },
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
          <div className="h-16 flex items-center justify-center md:justify-start md:px-4 border-b border-border shrink-0">
            <span className="font-bold text-primary truncate hidden md:inline-block tracking-widest text-xs uppercase">
              INDOPACOM
            </span>
            <Activity className="h-6 w-6 text-primary md:hidden" />
          </div>
          <nav className="flex flex-col gap-1 p-2 mt-4">
            {navItems.map((item) => {
              const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
            <Button variant="outline" size="sm" className="hidden sm:flex items-center gap-2 border-border bg-secondary/50 hover:bg-secondary">
              <Search className="h-4 w-4" />
              <span className="text-muted-foreground">Cmd + K</span>
            </Button>
            <div className="px-2 py-1 bg-destructive/20 border border-destructive/50 text-destructive text-xs font-mono rounded font-bold tracking-wider animate-pulse">
              OPCON: HEIGHTENED
            </div>
          </div>
          <div className="flex items-center gap-4">
            <RoleBadge />
            <div className="h-6 w-px bg-border mx-1"></div>
            <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs hidden sm:flex">
              <Clock className="h-4 w-4" />
              <span>{new Date().toISOString().slice(11, 16)} ZULU</span>
            </div>
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
    </div>
  );
}
