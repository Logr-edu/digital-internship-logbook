"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Users, Shield, Mail, Clock, CheckCircle2,
  AlertCircle, ArrowUpRight, ChevronRight, FileSpreadsheet,
  Plus, History, Building2, GraduationCap
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminOverviewSkeleton } from "@/components/admin/AdminSkeletons";
import { adminApi, type AdminStats, type AdminAuditEntry } from "@/lib/api/admin";

export default function AdminOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<AdminAuditEntry[]>([]);
  const [activeFacultyId, setActiveFacultyId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [statsRes, logsRes] = await Promise.all([
        adminApi.getOverviewStats(),
        adminApi.getAuditLog({ page: 1, pageSize: 4 }),
      ]);
      if (!mounted) return;
      if (statsRes.ok) {
        setStats(statsRes.data);
        if (statsRes.data.facultyBreakdown && statsRes.data.facultyBreakdown.length > 0) {
          setActiveFacultyId(statsRes.data.facultyBreakdown[0].id);
        }
      } else {
        setStats({
          totalStudents: 0,
          activeCoordinators: 0,
          pendingInvitations: 0,
          weeksSubmittedThisWeek: 0,
          cohortCompletionRate: 0,
          overdueWeeksCount: 0,
        });
      }
      if (logsRes.ok) setRecentLogs(logsRes.data.results);
      setLoading(false);
    }
    load();
    async function refreshStats() {
      const response = await adminApi.getOverviewStats();
      if (mounted && response.ok) setStats(response.data);
    }
    const refreshTimer = setInterval(refreshStats, 15000);
    window.addEventListener("focus", refreshStats);
    return () => {
      mounted = false;
      clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshStats);
    };
  }, []);

  return (
    <AdminShell
      title="Admin Overview"
      subtitle="System administration and cohort management"
      actions={
        <Link
          href="/admin/invitations"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#141414] text-white text-[11px] font-semibold hover:bg-[#282828] transition-colors shadow-xs"
        >
          <Plus className="size-3.5" />
          <span>Invite Coordinator</span>
        </Link>
      }
    >
      {loading || !stats ? (
        <AdminOverviewSkeleton />
      ) : (
        <div className="space-y-6">
          
          {/* Pending Students Alert */}
          {Boolean(stats.pendingStudents && stats.pendingStudents > 0) && (
            <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 rounded-full bg-amber-500/20 text-amber-900 items-center justify-center text-[12px] font-bold shrink-0">
                  {stats.pendingStudents}
                </span>
                <div>
                  <h4 className="text-[13px] font-bold text-amber-950">
                    {stats.pendingStudents} verified student{stats.pendingStudents === 1 ? "" : "s"} waiting for cohort assignment
                  </h4>
                  <p className="text-[11.5px] text-amber-900/80">
                    Create matching cohorts in the Cohorts portal to auto-enrol them into SWEP or SIWES.
                  </p>
                </div>
              </div>
              <Link
                href="/admin/cohorts"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-900 text-white text-[11.5px] font-semibold hover:bg-amber-950 transition-colors shrink-0"
              >
                <span>Manage Cohorts</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          )}

          {/* Key Administration Metrics Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
              <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">
                Enrolled Students
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                  {stats.totalStudents}
                </span>
                <span className="text-[11px] text-[#7A7973]">students</span>
              </div>
              <p className="text-[10.5px] text-[#7A7973] mt-0.5">
                {stats.departments ? `Across ${stats.departments} department${stats.departments !== 1 ? "s" : ""}` : "Across active departments"}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
              <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">
                Coordinators
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                  {stats.activeCoordinators}
                </span>
                <span className="text-[11px] text-[#7A7973]">active</span>
              </div>
              <p className="text-[10.5px] text-amber-700 font-medium mt-0.5">
                {stats.pendingInvitations} invitations pending
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
              <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">
                Submissions This Week
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                  {stats.weeksSubmittedThisWeek}
                </span>
                <span className="text-[11px] text-[#7A7973]">submitted</span>
              </div>
              <p className="text-[10.5px] text-emerald-700 font-medium mt-0.5">
                {stats.cohortCompletionRate}% overall submission rate
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
              <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">
                Overdue Weeks
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                  {stats.overdueWeeksCount}
                </span>
                <span className="text-[11px] text-[#7A7973]">overdue</span>
              </div>
              <p className="text-[10.5px] text-red-600 font-medium mt-0.5">Past submission cutoff</p>
            </div>
          </div>

          {/* Sleek, Compact Faculty & Department Breakdown Widget */}
          {stats.facultyBreakdown && stats.facultyBreakdown.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 sm:p-5 shadow-xs space-y-3.5">
              
              {/* Header with Segmented Faculty Toggle & Direct Link */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0EFE9]">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] flex items-center justify-center text-[#141414]">
                    <Building2 className="size-4 text-[#7A7973]" />
                  </div>
                  <div>
                    <h3 className="text-[13px] font-bold text-[#141414] leading-tight">Faculty Enrolment Breakdown</h3>
                    <p className="text-[11px] text-[#7A7973]">
                      {stats.totalStudents} total students across {stats.facultyBreakdown.length} faculties
                    </p>
                  </div>
                </div>

                {/* Compact Faculty Selector Pills */}
                <div className="flex items-center gap-1.5 bg-[#FAF9F5] p-1 rounded-xl border border-[#E8E7E1] self-start sm:self-auto">
                  {stats.facultyBreakdown.map((fac) => {
                    const isActive = (activeFacultyId ?? stats.facultyBreakdown?.[0]?.id) === fac.id;
                    const isFcse = fac.code === "FCSE";
                    return (
                      <button
                        key={fac.id}
                        type="button"
                        onClick={() => setActiveFacultyId(fac.id)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                          isActive
                            ? "bg-white text-[#141414] shadow-xs border border-[#E0DFD8]"
                            : "text-[#7A7973] hover:text-[#141414]"
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${isFcse ? "bg-indigo-600" : "bg-emerald-600"}`} />
                        <span>{fac.code}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                            isActive ? "bg-[#141414] text-white" : "bg-[#EFEFEA] text-[#7A7973]"
                          }`}
                        >
                          {fac.studentsCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Faculty Details & Department Grid */}
              {(() => {
                const activeFac =
                  stats.facultyBreakdown.find((f) => f.id === activeFacultyId) ||
                  stats.facultyBreakdown[0];
                if (!activeFac) return null;
                return (
                  <div className="space-y-3">
                    {/* Subheader bar with Faculty name & Direct Link */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11.5px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#141414]">{activeFac.name}</span>
                        <span className="text-[#9A9990]">&middot;</span>
                        <span className="text-[#7A7973] font-mono text-[11px]">{activeFac.departmentsCount} departments</span>
                        <span className="text-[#9A9990]">&middot;</span>
                        <span className="text-[#7A7973] font-mono text-[11px]">{activeFac.coordinatorsCount} coordinators</span>
                      </div>

                      <Link
                        href={`/admin/students?faculty=${activeFac.id}`}
                        className="text-[11px] font-semibold text-[#141414] hover:underline flex items-center gap-1 shrink-0 self-start sm:self-auto"
                      >
                        <span>View all {activeFac.code} students</span>
                        <ArrowUpRight className="size-3" />
                      </Link>
                    </div>

                    {/* Compact 2/3/4 Column Grid of Departments */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {activeFac.departments.map((dept) => (
                        <Link
                          key={dept.id}
                          href={`/admin/students?faculty=${activeFac.id}&department=${dept.id}`}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-[#EFEFEA] bg-[#FAF9F5] hover:bg-white hover:border-[#141414] transition-all group"
                          title={`Filter students in ${dept.name}`}
                        >
                          <span className="text-[11.5px] font-medium text-[#3A3934] group-hover:text-[#141414] truncate mr-2">
                            {dept.name}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md shrink-0 transition-colors ${
                              dept.studentsCount > 0
                                ? "bg-[#141414] text-white"
                                : "bg-[#EAE9E3] text-[#7A7973] group-hover:bg-[#DEDCD4]"
                            }`}
                          >
                            {dept.studentsCount}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Lower 12-Column Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left 7 Cols: Audit Activity Log */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-[#F0EFE9] flex items-center justify-between">
                <div>
                  <h3 className="text-[13px] font-bold text-[#141414]">Audit Log</h3>
                  <p className="text-[11px] text-[#7A7973]">Recent administrative actions and events</p>
                </div>
                <Link
                  href="/admin/audit"
                  className="text-[11px] font-semibold text-[#141414] hover:underline flex items-center gap-1"
                >
                  View all logs <ArrowUpRight className="size-3.5" />
                </Link>
              </div>

              <div className="divide-y divide-[#F0EFE9] flex-1">
                {recentLogs.map((log) => (
                  <div key={log.id} className="p-4 sm:p-5 flex items-start justify-between gap-3 hover:bg-[#FAF9F5] transition-colors">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-[#141414] truncate">
                          {log.action.replace(/_/g, " ")}
                        </span>
                        <span className="text-[9.5px] font-mono text-[#7A7973] bg-[#F5F4EF] px-1.5 py-0.2 rounded border border-[#E8E7E1]">
                          {log.role}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-[#5A5954] truncate">{log.target}</p>
                      <p className="text-[10px] text-[#9A9990] font-mono">
                        by {log.actor} &middot; {log.timestamp} &middot; IP {log.ipAddress}
                      </p>
                    </div>

                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                      <CheckCircle2 className="size-2.5" /> Recorded
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right 5 Cols: Quick Governance Actions */}
            <div className="lg:col-span-5 space-y-6">
              
              <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 shadow-xs space-y-3">
                <h3 className="text-[13px] font-bold text-[#141414]">Quick Links</h3>
                <div className="space-y-2">
                  {[
                    { label: "Student directory", href: "/admin/students", icon: <Users className="size-3.5" /> },
                    { label: "Coordinators", href: "/admin/coordinators", icon: <Shield className="size-3.5" /> },
                    { label: "Coordinator invitations", href: "/admin/invitations", icon: <Mail className="size-3.5" /> },
                    { label: "Cohort schedules", href: "/admin/cohorts", icon: <Clock className="size-3.5" /> },
                    { label: "Department reports & CSV export", href: "/admin/reports", icon: <FileSpreadsheet className="size-3.5" /> },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center justify-between p-3 rounded-xl border border-[#E8E7E1] hover:border-[#D8D7CE] hover:bg-[#FAF9F5] transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 text-[12px] font-medium text-[#141414]">
                        <span className="text-[#7A7973] group-hover:text-[#141414] transition-colors">{item.icon}</span>
                        <span>{item.label}</span>
                      </div>
                      <ChevronRight className="size-3.5 text-[#9A9990] group-hover:text-[#141414] group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ))}
                </div>
              </div>

              {/* Security & Access Banner */}
              <div className="p-4 rounded-2xl bg-[#141414] text-white shadow-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#F04D23]" />
                  <p className="text-[12px] font-bold">Audit Compliance</p>
                </div>
                <p className="text-[11px] text-white/70 leading-relaxed">
                  All administrative updates, user status changes, and coordinator invitations are recorded in the system audit log.
                </p>
              </div>

            </div>

          </div>

        </div>
      )}
    </AdminShell>
  );
}
