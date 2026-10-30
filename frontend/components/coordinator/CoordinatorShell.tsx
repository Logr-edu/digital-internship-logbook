"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, CheckSquare, Clock, Calendar,
  Settings, User, LogOut, Menu, X, ArrowUpRight
} from "lucide-react";
import { authApi } from "@/lib/api/auth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

export function CoordinatorShell({
  children,
  title,
  subtitle,
  actions,
  activeHref,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  activeHref?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attendanceEnabled, setAttendanceEnabled] = useState(false);
  const [profile, setProfile] = useState<{ name: string; dept: string; prog: string } | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("logr_user_profile");
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
    }
    return null;
  });

  useEffect(() => {
    let mounted = true;
    authApi.coordinatorProfile().then((res) => {
      if (mounted && res.ok && res.data?.profile) {
        const p = res.data.profile;
        setAttendanceEnabled(p.programme === "SWEP");
        const name = `${p.account.first_name || ""} ${p.account.last_name || ""}`.trim();
        const dept = (typeof p.department === "string" ? p.department : p.department?.name) || "—";
        const prog = p.programme || "SWEP";
        const profObj = { name: name || "Coordinator", dept, prog };
        setProfile(profObj);
        localStorage.setItem("logr_user_profile", JSON.stringify(profObj));
      }
    });
    return () => { mounted = false; };
  }, []);

  const navItems: NavItem[] = [
    { label: "Overview",            href: "/coordinator",             icon: <LayoutDashboard className="size-4" /> },
    { label: "Weekly Reviews",      href: "/coordinator/students?filter=needs_review", icon: <CheckSquare className="size-4" /> },
    { label: "Students & Cohort",   href: "/coordinator/students",    icon: <Users className="size-4" /> },
    { label: "Extension Requests",  href: "/coordinator/extensions",  icon: <Clock className="size-4" /> },
    ...(attendanceEnabled ? [{ label: "SWEP Attendance", href: "/coordinator/attendance", icon: <Calendar className="size-4" /> }] : []),
    { label: "Cohort Settings",     href: "/coordinator/cohort",      icon: <Settings className="size-4" /> },
    { label: "Profile",             href: "/coordinator/profile",     icon: <User className="size-4" /> },
  ];

  function handleLogout() {
    authApi.logout?.();
    router.replace("/login");
  }

  const initials = profile?.name
    ? profile.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "CO";
  const displayName = profile?.name || "Coordinator";
  const deptLabel = profile ? `${profile.prog} · ${profile.dept}` : "Institutional Coordinator";

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex font-sans selection:bg-[#F04D23] selection:text-white text-[#141414]">
      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Coordinator Sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 w-[240px] bg-[#EDECE6] border-r border-[#D8D7CE] flex flex-col transition-transform duration-250 ease-out lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? "translate-x-0 shadow-lg lg:shadow-none" : "-translate-x-full"
        }`}
      >
        {/* Logo / Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-[#D8D7CE]">
          <Link href="/coordinator" className="flex items-center gap-2 group">
            <span className="size-2 rounded-full bg-[#F04D23] group-hover:scale-125 transition-transform shrink-0" />
            <span className="text-[16px] font-extrabold tracking-[-0.03em] text-[#141414]">Logr</span>
            <span className="text-[11px] text-[#7A7973] font-normal ml-0.5">/ Coordinator</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-[#7A7973] hover:text-[#141414] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Coordinator Profile Card */}
        <div className="p-4 border-b border-[#D8D7CE]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#E8E7E1]">
            <div className="size-8 rounded-full bg-[#141414] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-[#141414] truncate">{displayName}</p>
              <p className="text-[10px] text-[#7A7973] truncate font-mono">{deptLabel}</p>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = activeHref ? item.href === activeHref : (
              pathname === item.href ||
              (item.href !== "/coordinator" && pathname.startsWith(item.href))
            );

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[12.5px] font-medium transition-colors ${
                  active
                    ? "bg-[#141414] text-white"
                    : "text-[#5A5954] hover:text-[#141414] hover:bg-white/70"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 ${active ? "text-white" : "text-[#7A7973]"}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge != null && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                      active ? "bg-white text-[#141414]" : "bg-[#F04D23] text-white"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sign Out Action */}
        <div className="p-3 border-t border-[#D8D7CE]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-[12px] font-medium text-[#7A7973] hover:text-red-600 hover:bg-red-50/70 transition-colors"
          >
            <LogOut className="size-4 shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 flex items-center justify-between px-5 sm:px-8 bg-[#EDECE6] border-b border-[#D8D7CE] sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-[#7A7973] hover:text-[#141414] hover:bg-white/60 transition-colors"
              aria-label="Open sidebar"
            >
              <Menu className="size-5" />
            </button>
            <div>
              <h1 className="text-[14px] sm:text-[15px] font-bold text-[#141414]">
                {title || "Coordinator Portal"}
              </h1>
              <p className="text-[11px] text-[#7A7973] font-mono">
                {subtitle || "Department of Computer Science & Engineering &middot; OAU"}
              </p>
            </div>
          </div>

          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>

        {/* Centered Desktop Layout */}
        <main className="flex-1 w-full max-w-[1180px] mx-auto px-5 sm:px-8 py-6 space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
