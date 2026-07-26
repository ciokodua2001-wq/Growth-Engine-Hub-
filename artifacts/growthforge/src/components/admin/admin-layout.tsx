import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import {
  LayoutDashboard, Users, FolderOpen, CreditCard, Brain,
  FileText, HeadphonesIcon, BarChart2, ToggleLeft, Settings,
  Activity, Shield, Megaphone, ChevronLeft, ChevronRight,
  LogOut, Menu, Loader2, DatabaseZap, Wallet, Crown,
  TrendingUp, Mail, BookUser,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useIsOwner } from "@/hooks/use-is-owner";

const NAV = [
  { label: "Dashboard",     href: "/admin",              icon: LayoutDashboard },
  { label: "Users",         href: "/admin/users",        icon: Users },
  { label: "Projects",      href: "/admin/projects",     icon: FolderOpen },
  { label: "Subscriptions", href: "/admin/subscriptions",icon: CreditCard },
  { label: "Credit Banks",  href: "/admin/credits",      icon: Wallet },
  { label: "Data Integrity", href: "/admin/integrity",   icon: DatabaseZap },
  { label: "AI Usage",      href: "/admin/ai",           icon: Brain },
  { label: "Content",       href: "/admin/content",      icon: FileText },
  { label: "Support",       href: "/admin/support",      icon: HeadphonesIcon },
  { label: "Analytics",     href: "/admin/analytics",    icon: BarChart2 },
  { label: "Feature Flags", href: "/admin/features",     icon: ToggleLeft },
  { label: "Announcements", href: "/admin/announcements",icon: Megaphone },
  { label: "Activity",      href: "/admin/activity",     icon: Activity },
  { label: "Audit Log",     href: "/admin/audit",        icon: Shield },
  { label: "Settings",      href: "/admin/settings",     icon: Settings },
];

const OWNER_NAV = [
  { label: "Growth Dashboard", href: "/admin/owner/dashboard", icon: TrendingUp },
  { label: "Email Marketing",  href: "/admin/owner/campaigns", icon: Mail },
  { label: "Contacts",         href: "/admin/owner/contacts",  icon: BookUser },
];

interface Props { children: React.ReactNode }

export default function AdminLayout({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const isOwner = useIsOwner();

  // Direct navigation to /admin (e.g. typing the URL, or a bookmark) should
  // prompt sign-in immediately instead of rendering a dead-end "Access
  // Denied" screen. signInFallbackRedirectUrl already routes admins to
  // /admin post-login, so bouncing here is enough to land them right back.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/sign-in?redirect_url=/admin", { replace: true });
    }
  }, [isLoaded, isSignedIn, setLocation]);

  const isActive = (href: string) =>
    href === "/admin" ? location === "/admin" : location.startsWith(href);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#040B14" }}>
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/8 shrink-0 ${collapsed ? "justify-center" : ""}`}>
        <Logo size={36} />
        {!collapsed && (
          <div>
            <div className="text-white font-bold text-sm leading-none">GrowthForge</div>
            <div className="text-[10px] font-semibold mt-0.5" style={{ color: "#00E676" }}>ADMIN</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {NAV.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActive(href) ? "text-black" : "text-white/50 hover:text-white hover:bg-white/5"
            } ${collapsed ? "justify-center" : ""}`}
            style={isActive(href) ? { background: "#00E676" } : {}}>
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}

        {/* Owner's Corner — only visible to the platform owner */}
        {isOwner && (
          <>
            {!collapsed && (
              <div className="flex items-center gap-2 px-3 pt-5 pb-1.5">
                <Crown className="w-3 h-3 shrink-0" style={{ color: "#fbbf24" }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#fbbf24" }}>
                  Owner's Corner
                </span>
              </div>
            )}
            {collapsed && <div className="pt-4 pb-1 flex justify-center"><Crown className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} /></div>}
            <Link href="/admin"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all text-white/30 hover:text-white/60 ${collapsed ? "justify-center" : ""}`}>
              <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
              {!collapsed && <span>Back to Dashboard</span>}
            </Link>
            {OWNER_NAV.map(({ label, href, icon: Icon }) => (
              <Link key={href} href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive(href) ? "text-black" : "text-white/40 hover:text-white hover:bg-amber-500/8"
                } ${collapsed ? "justify-center" : ""}`}
                style={isActive(href) ? { background: "#fbbf24" } : {}}>
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="shrink-0 p-4 border-t border-white/8 space-y-2">
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/4 mb-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-black"
              style={{ background: "#00E676" }}>
              {(user.primaryEmailAddress?.emailAddress ?? "A")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">
                {user.primaryEmailAddress?.emailAddress ?? "Admin"}
              </div>
              <div className="text-[10px] text-white/40">Super Admin</div>
            </div>
          </div>
        )}
        <button onClick={() => signOut({ redirectUrl: "/" })}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all ${collapsed ? "justify-center" : ""}`}>
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && "Sign Out"}
        </button>
        <Link href="/dashboard"
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs text-white/30 hover:text-white/60 transition-all ${collapsed ? "justify-center" : ""}`}>
          <ChevronLeft className="w-3 h-3 shrink-0" />
          {!collapsed && "Back to App"}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#040B14" }}>
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col shrink-0 border-r border-white/8 transition-all duration-200 relative ${collapsed ? "w-16" : "w-56"}`}
        style={{ background: "#060f1e" }}>
        <SidebarContent />
        <button onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full border border-white/10 flex items-center justify-center bg-[#0d1b2e] text-white/40 hover:text-white transition-all z-10">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 border-r border-white/8 flex flex-col"
            style={{ background: "#060f1e" }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 py-4 border-b border-white/8 shrink-0"
          style={{ background: "#060f1e" }}>
          <button onClick={() => setMobileOpen(true)} className="text-white/60 hover:text-white">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <span className="text-white text-sm font-bold">Admin</span>
          </div>
          <div className="w-5" />
        </div>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
