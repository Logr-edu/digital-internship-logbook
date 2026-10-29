"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen, Calendar, CheckCircle2, ArrowUpRight,
  LayoutDashboard, Star, User, LogOut, ChevronRight,
  ChevronDown, ChevronUp, PenLine, AlertCircle, Menu,
  X, Lock, Clock, GraduationCap, Briefcase, Info,
  ShieldCheck, ShieldAlert, Inbox
} from "lucide-react";
import {
  studentApi,
  type StudentDashboardData,
  type StudentDayData,
  type DayStatus,
  type WeekStatus,
  type CohortData
} from "@/lib/api/student";
import { authApi } from "@/lib/api/auth";

/* ── Types ────────────────────────────────────────────────────────── */
type NavItem = { label: string; href: string; icon: React.ReactNode; active?: boolean };

/* ── Logo ─────────────────────────────────────────────────────────── */
function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <span className="size-2 rounded-full bg-[#F04D23] group-hover:scale-125 transition-transform shrink-0" />
      <span className="text-[16px] font-extrabold tracking-[-0.03em] text-[#141414]">Logr</span>
      <span className="text-[11px] text-[#7A7973] font-normal ml-0.5">/ OAU</span>
    </Link>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────── */
function Sidebar({
  nav,
  open,
  onClose,
  studentName,
  matricNo,
  programme,
  onSignOut,
}: {
  nav: NavItem[];
  open: boolean;
  onClose: () => void;
  studentName: string;
  matricNo: string;
  programme: string;
  onSignOut: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 w-[230px] bg-[#EDECE6] border-r border-[#D8D7CE] flex flex-col transition-transform duration-250 ease-out lg:translate-x-0 lg:static lg:z-auto ${
          open ? "translate-x-0 shadow-lg lg:shadow-none" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-[#D8D7CE]">
          <Logo />
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-[#7A7973] hover:text-[#141414] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Student Profile Identity Card */}
        <div className="p-4 border-b border-[#D8D7CE]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#E8E7E1]">
            <div className="size-8 rounded-full bg-[#141414] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
              {studentName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "ST"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-[#141414] truncate">{studentName}</p>
              <p className="text-[10px] text-[#7A7973] font-mono truncate">{matricNo} &middot; {programme}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[12.5px] font-medium transition-colors ${
                item.active
                  ? "bg-[#141414] text-white"
                  : "text-[#5A5954] hover:text-[#141414] hover:bg-white/70"
              }`}
            >
              <span className={`shrink-0 ${item.active ? "text-white" : "text-[#7A7973]"}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Bottom sign out */}
        <div className="p-3 border-t border-[#D8D7CE]">
          <button
            onClick={onSignOut}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-[12px] font-medium text-[#7A7973] hover:text-red-600 hover:bg-red-50/70 transition-colors cursor-pointer"
          >
            <LogOut className="size-4 shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── Status Chips ─────────────────────────────────────────────────── */
function DayChip({ status }: { status: DayStatus }) {
  const map: Record<DayStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    ready:     { label: "Ready",       cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <CheckCircle2 className="size-2.5" /> },
    draft:     { label: "Draft",       cls: "bg-[#F5F4EF] text-[#7A7973] border-[#E8E7E1]", icon: <Clock className="size-2.5" /> },
    empty:     { label: "Empty",       cls: "bg-[#F5F4EF] text-[#9A9990] border-[#E8E7E1]" },
    submitted: { label: "Submitted",   cls: "bg-[#F5F4EF] text-[#5A5954] border-[#E8E7E1]", icon: <Lock className="size-2.5" /> },
    reviewed:  { label: "Reviewed",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <Star className="size-2.5" /> },
    returned:  { label: "Returned",    cls: "bg-orange-50 text-orange-700 border-orange-200", icon: <AlertCircle className="size-2.5" /> },
    future:    { label: "Upcoming",    cls: "text-[#C0BFB9] border-transparent bg-transparent" },
    holiday:   { label: "Holiday",     cls: "text-[#C0BFB9] border-transparent bg-transparent" },
  };
  const { label, cls, icon } = map[status] || { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md border ${cls}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function WeekChip({ status }: { status: WeekStatus }) {
  const map: Record<WeekStatus, { label: string; cls: string }> = {
    in_progress: { label: "In progress", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    submitted:   { label: "Submitted",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
    reviewed:    { label: "Reviewed",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    returned:    { label: "Returned",    cls: "bg-orange-50 text-orange-700 border-orange-200" },
    overdue:     { label: "Overdue",     cls: "bg-red-50 text-red-600 border-red-200" },
    missed:      { label: "Missed",      cls: "bg-[#F5F4EF] text-[#7A7973] border-[#E8E7E1]" },
  };
  const { label, cls } = map[status] || { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

/* ── Day Card ─────────────────────────────────────────────────────── */
interface DayTileProps {
  dayShort: string;
  dateStr: string;
  displayDate: string;
  status: DayStatus;
  href?: string;
  rating?: number;
}

function DayTile({ dayShort, displayDate, status, href, rating }: DayTileProps) {
  const clickable = !["future", "holiday"].includes(status);
  const bg =
    status === "returned"  ? "bg-orange-50/60 border-orange-200" :
    status === "reviewed"  ? "bg-emerald-50/50 border-emerald-200" :
    status === "ready"     ? "bg-amber-50/60 border-amber-200" :
    ["future", "holiday"].includes(status) ? "bg-transparent border-[#F0EFE9] opacity-60" :
    "bg-white border-[#E8E7E1] hover:border-[#D8D7CE]";

  const content = (
    <div className={`p-3.5 rounded-xl border flex flex-col justify-between min-h-[96px] transition-all ${bg} ${clickable ? "hover:shadow-xs cursor-pointer" : "cursor-default"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">{dayShort}</span>
        {rating != null && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded">
            {rating}/5
          </span>
        )}
      </div>
      <div className="my-1.5">
        <span className="text-[13px] font-bold text-[#141414] leading-tight">{displayDate}</span>
      </div>
      <div>
        <DayChip status={status} />
      </div>
    </div>
  );

  if (clickable && href) {
    return <Link href={href} className="flex-1 min-w-[110px]">{content}</Link>;
  }
  return <div className="flex-1 min-w-[110px]">{content}</div>;
}

/* ── Programme & Session Matching Mini UI ─────────────────────────── */
function ProgrammeSessionCard({
  isMatched,
  cohort,
  student,
}: {
  isMatched: boolean;
  cohort: CohortData | null;
  student: StudentDashboardData["student"];
}) {
  const [expandedGuidelines, setExpandedGuidelines] = useState(false);

  const progFullName =
    student.programme === "SWEP"
      ? "Student Work Experience Programme (SWEP)"
      : "Students Industrial Work Experience Scheme (SIWES)";

  if (!isMatched || !cohort) {
    return (
      <div className="rounded-2xl border border-[#E8E7E1] bg-white p-5 sm:p-6 shadow-xs space-y-4">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#F0EFE9]">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <Clock className="size-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-bold text-[#141414]">Programme & Session Allocation</h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  <Clock className="size-2.5" /> Awaiting Session Cohort
                </span>
              </div>
              <p className="text-[11px] text-[#7A7973]">
                {student.department} &middot; {student.programme}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-[10px] font-mono text-[#7A7973] uppercase tracking-wider">Account Status</span>
            <p className="text-[12px] font-semibold text-emerald-700 flex items-center sm:justify-end gap-1">
              <CheckCircle2 className="size-3 text-emerald-600" /> Profile Verified & Ready
            </p>
          </div>
        </div>

        {/* Informative Guidance Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#7A7973] uppercase">Department Track</span>
            <p className="text-[12.5px] font-bold text-[#141414] truncate">{student.department}</p>
            <p className="text-[10.5px] text-[#7A7973]">{progFullName}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#7A7973] uppercase">Session Status</span>
            <p className="text-[12.5px] font-bold text-amber-800">Pending Cohort Launch</p>
            <p className="text-[10.5px] text-[#7A7973]">Department coordinator has not launched session</p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-1">
            <span className="text-[10px] font-mono font-medium text-[#7A7973] uppercase">Student Identification</span>
            <p className="text-[12.5px] font-mono font-bold text-[#141414]">{student.matricNo}</p>
            <p className="text-[10.5px] text-[#7A7973]">{student.name}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-3 text-[11.5px] text-amber-900 leading-relaxed">
          <Info className="size-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">No action is required from you at this moment.</p>
            <p className="text-amber-800">
              Your student profile is active. As soon as your Department Coordinator launches the official{" "}
              <strong>{student.programme}</strong> cohort for this academic session, your account will be automatically matched, and your daily logging interface, calendar weeks, and submission deadlines will unlock immediately.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Matched State
  const hasStarted = cohort.has_started ?? (cohort.status === "ACTIVE");
  const isUpcoming = !hasStarted || cohort.status === "UPCOMING";
  const hasCoordinator = Boolean(cohort.has_coordinator || cohort.coordinator_name || cohort.coordinator);
  const coordinatorDisplay = cohort.coordinator_name
    ? `${cohort.coordinator_name} (${cohort.coordinator_email || ""})`
    : cohort.coordinator
    ? cohort.coordinator
    : null;

  const startDateStr = new Date(cohort.start_date + "T00:00:00").toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const endDateStr = new Date(cohort.end_date + "T00:00:00").toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="rounded-2xl border border-[#E8E7E1] bg-white p-5 sm:p-6 shadow-xs space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#F0EFE9]">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            {cohort.programme === "SWEP" ? (
              <GraduationCap className="size-4.5" />
            ) : (
              <Briefcase className="size-4.5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-bold text-[#141414]">
                {cohort.name || `${cohort.programme} · ${cohort.session} Session`}
              </h2>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                isUpcoming
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}>
                <CheckCircle2 className="size-2.5" />
                {isUpcoming ? "Scheduled & Upcoming" : "Active Session"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#7A7973] flex-wrap mt-0.5">
              <span>{cohort.department_name || cohort.department}</span>
              <span>&bull;</span>
              {hasCoordinator ? (
                <span className="text-[#141414] font-medium">
                  Coordinator: {coordinatorDisplay}
                </span>
              ) : (
                <span className="text-amber-800 font-medium inline-flex items-center gap-1">
                  <ShieldAlert className="size-3 text-amber-600" />
                  Coordinator pending assignment
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => setExpandedGuidelines(!expandedGuidelines)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#D8D7CE] hover:bg-[#FAF9F5] text-[11px] font-semibold text-[#5A5954] hover:text-[#141414] transition-colors self-start sm:self-center cursor-pointer"
        >
          <span>{expandedGuidelines ? "Hide guidelines" : "View programme guidelines"}</span>
          {expandedGuidelines ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {/* Coordinator Pending Notice */}
      {!hasCoordinator && (
        <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-2.5 text-[11.5px] text-amber-900 leading-relaxed">
          <AlertCircle className="size-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-950">Coordinator Pending Assignment</p>
            <p className="text-amber-800">
              An administrator will assign your department coordinator shortly. You are officially enrolled in the cohort and can review the schedule and requirements below.
            </p>
          </div>
        </div>
      )}

      {/* Cohort Starting Soon Notice */}
      {isUpcoming && (
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 flex items-start gap-2.5 text-[11.5px] text-blue-900 leading-relaxed">
          <Calendar className="size-4 text-blue-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-blue-950">
              Session Commences on {startDateStr} {cohort.days_until_start ? `(in ${cohort.days_until_start} day${cohort.days_until_start > 1 ? 's' : ''})` : ""}
            </p>
            <p className="text-blue-800">
              Daily logbook documentation and submissions will officially open once the cohort begins on {startDateStr}.
            </p>
          </div>
        </div>
      )}

      {/* Programme Metadata Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-0.5">
          <span className="text-[9.5px] font-mono uppercase text-[#7A7973]">Academic Period</span>
          <p className="text-[12px] font-bold text-[#141414]">{cohort.session}</p>
          <p className="text-[10px] text-[#7A7973]">{cohort.total_weeks} Total Weeks</p>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-0.5">
          <span className="text-[9.5px] font-mono uppercase text-[#7A7973]">Calendar Dates</span>
          <p className="text-[12px] font-bold text-[#141414]">{startDateStr}</p>
          <p className="text-[10px] text-[#7A7973]">to {endDateStr}</p>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-0.5">
          <span className="text-[9.5px] font-mono uppercase text-[#7A7973]">Working Schedule</span>
          <p className="text-[12px] font-bold text-[#141414]">Mon &ndash; Fri (5 Days)</p>
          <p className="text-[10px] text-[#7A7973]">Daily activities logged</p>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-0.5">
          <span className="text-[9.5px] font-mono uppercase text-[#7A7973]">Submission Deadline</span>
          <p className="text-[12px] font-bold text-[#141414]">Every Saturday</p>
          <p className="text-[10px] text-red-600 font-medium">11:59 PM strict cutoff</p>
        </div>
      </div>

      {/* Collapsible Orientation Guidelines */}
      {expandedGuidelines && (
        <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-3 transition-all">
          <h3 className="text-[12px] font-bold text-[#141414] flex items-center gap-1.5">
            <Info className="size-3.5 text-[#F04D23]" />
            <span>Essential Logbook Guidelines & Academic Regulations</span>
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-[11.5px] text-[#5A5954] leading-relaxed">
            <li>
              <strong className="text-[#141414]">Daily Logging Requirement:</strong> Each working day, write your technical tasks, tools used, and personal reflections (minimum 30 characters). Logs should be written during or immediately after your work session.
            </li>
            <li>
              <strong className="text-[#141414]">Weekly Submissions:</strong> Every Saturday by 11:59 PM, submit your full week for coordinator assessment. All scheduled working days within your cohort dates must be filled before submission unlocks.
            </li>
            {cohort.programme === "SWEP" ? (
              <li>
                <strong className="text-[#141414]">On-Campus Daily Attendance:</strong> Your coordinator generates an attendance code each working day. You must enter the 6-character code before the session expires to be marked Present.
              </li>
            ) : (
              <li>
                <strong className="text-[#141414]">Workplace Supervisor Sign-Off:</strong> At regular intervals, dispatch review links to your industry workplace supervisor so they can evaluate your performance and provide an authorized digital signature.
              </li>
            )}
            <li>
              <strong className="text-[#141414]">Deadline Extensions:</strong> If you experience medical or technical emergencies that prevent timely submission, submit an extension appeal before the grace period expires.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

/* ── Dashboard Page ───────────────────────────────────────────────── */
export default function StudentDashboardPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<StudentDashboardData | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      const res = await studentApi.getDashboard();
      if (res.ok) {
        setDashboard(res.data);
      } else if (res.status === 401) {
        router.replace("/login");
      }
      setLoading(false);
    }
    loadDashboard();
  }, [router]);

  async function handleSignOut() {
    await authApi.logout();
    router.replace("/login");
  }

  const isMatched = dashboard?.isMatched ?? false;
  const cohort = dashboard?.cohort ?? null;
  const currentWeekNumber = dashboard?.metrics.currentWeek || 1;
  const programme = dashboard?.student.programme || "SWEP";

  // Sidebar navigation tailored to SWEP vs SIWES
  const nav: NavItem[] = [
    { label: "Dashboard", href: "/student", icon: <LayoutDashboard className="size-4" />, active: true },
    {
      label: "Logbook",
      href: isMatched ? `/student/week/${currentWeekNumber}` : "#",
      icon: <BookOpen className="size-4" />,
    },
    ...(programme === "SWEP"
      ? [{ label: "Attendance", href: "/student/attendance", icon: <Calendar className="size-4" /> }]
      : [{ label: "Reviews", href: "/student/reviews", icon: <Star className="size-4" /> }]),
    { label: "Profile", href: "/student/profile", icon: <User className="size-4" /> },
  ];

  // Convert real current week days from API
  const currentDays: DayTileProps[] = (dashboard?.currentWeek?.days || []).map((d) => {
    const dateObj = new Date(d.date + "T00:00:00");
    const displayDate = dateObj.toLocaleDateString("en-NG", {
      day: "numeric",
      month: "short",
    });

    return {
      dayShort: d.dayShort,
      dateStr: d.date,
      displayDate,
      status: d.status,
      href: `/student/day/${d.date}`,
      rating: d.rating,
    };
  });

  const filledCount = dashboard?.currentWeek?.filledDays || 0;
  const totalWorkingDays = dashboard?.currentWeek?.totalDays || 5;
  const canSubmit = dashboard?.currentWeek?.canSubmit || false;

  const studentName = dashboard?.student.name || "Student";
  const matricNo = dashboard?.student.matricNo || "—";
  const firstName = studentName.split(" ")[0];

  // Use the training timezone, independent of the device timezone or weekly entries.
  const todayParts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const todayDate = ["year", "month", "day"]
    .map((part) => todayParts.find((value) => value.type === part)?.value)
    .join("-");
  const todayEntryHref = `/student/day/${todayDate}`;

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex font-sans selection:bg-[#F04D23] selection:text-white text-[#141414]">
      {/* Sidebar */}
      <Sidebar
        nav={nav}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        studentName={studentName}
        matricNo={matricNo}
        programme={programme}
        onSignOut={handleSignOut}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top bar */}
        <header className="h-16 flex items-center justify-between px-5 sm:px-8 bg-[#EDECE6] border-b border-[#D8D7CE] sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-[#7A7973] hover:text-[#141414] hover:bg-white/60 transition-colors cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="size-5" />
            </button>
            <div>
              <h1 className="text-[14px] sm:text-[15px] font-bold text-[#141414]">
                Good day, {firstName}
              </h1>
              <p className="text-[11px] text-[#7A7973] font-mono">
                {isMatched && cohort
                  ? `Week ${dashboard?.metrics.currentWeek || 1} of ${dashboard?.metrics.totalWeeks || 12} · ${cohort.programme} ${cohort.session}`
                  : `${dashboard?.student.department || "Department Pending"} · ${programme}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isMatched && (
              cohort?.has_started !== false ? (
                <Link
                  href={todayEntryHref}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#141414] text-white text-[12px] font-semibold hover:bg-[#282828] transition-colors shadow-xs"
                >
                  <PenLine className="size-3.5" />
                  <span>Write today&apos;s log</span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#F0EFEA] border border-[#D5D4CD] text-[#7A7973] text-[11.5px] font-medium">
                  <Calendar className="size-3.5" />
                  <span>Opens on {cohort?.start_date ? new Date(cohort.start_date + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "start date"}</span>
                </span>
              )
            )}
          </div>
        </header>

        {/* Centered Dashboard Content */}
        <main className="flex-1 w-full max-w-[1180px] mx-auto px-5 sm:px-8 py-6 space-y-6">
          
          {loading ? (
            <div className="p-12 text-center text-[13px] text-[#7A7973]">
              Loading student logbook and session allocation…
            </div>
          ) : (
            <>
              {/* Programme & Session Matching Mini UI Card */}
              {dashboard && (
                <ProgrammeSessionCard
                  isMatched={isMatched}
                  cohort={cohort}
                  student={dashboard.student}
                />
              )}

              {/* Active Attendance Alert Banner (Only for SWEP when attendance session is active) */}
              {isMatched && programme === "SWEP" && !dashboard?.checkedInToday && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 p-4 rounded-2xl bg-white border border-[#E8E7E1] shadow-xs">
                  <div className="flex items-center gap-3">
                    <span className="size-2 rounded-full bg-[#F04D23] animate-pulse shrink-0" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">SWEP Daily Attendance Verification</p>
                      <p className="text-[11px] text-[#7A7973]">Enter today&apos;s 6-character coordinator attendance code to verify your presence.</p>
                    </div>
                  </div>
                  <Link
                    href="/student/attendance"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#141414] text-white text-[11px] font-semibold hover:bg-[#282828] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>Enter code</span>
                    <ChevronRight className="size-3.5" />
                  </Link>
                </div>
              )}

              {/* Balanced Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
                  <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">Programme Period</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                      {isMatched ? `Week ${dashboard?.metrics.currentWeek || 1}` : "—"}
                    </span>
                    <span className="text-[11px] text-[#7A7973]">
                      / {isMatched ? `${dashboard?.metrics.totalWeeks || 12} total` : "pending"}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-[#7A7973] mt-0.5">
                    {isMatched
                      ? `${Math.max(0, (dashboard?.metrics.totalWeeks || 12) - (dashboard?.metrics.currentWeek || 1))} weeks remaining`
                      : "Awaiting cohort start"}
                  </p>
                </div>

                <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
                  <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">Days Logged</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                      {dashboard?.metrics.daysLogged || 0}
                    </span>
                    <span className="text-[11px] text-[#7A7973]">/ {totalWorkingDays} this week</span>
                  </div>
                  <p className="text-[10.5px] text-[#7A7973] mt-0.5">
                    {isMatched ? "Daily activity entries" : "Session not started"}
                  </p>
                </div>

                <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
                  <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">
                    {programme === "SWEP" ? "Attendance Rate" : "Verification Track"}
                  </p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                      {programme === "SWEP" ? `${dashboard?.metrics.attendanceRate || 100}%` : "SIWES"}
                    </span>
                    <span className="text-[11px] text-[#7A7973]">
                      {programme === "SWEP" ? "verified" : "workplace"}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-emerald-700 font-medium mt-0.5">
                    {programme === "SWEP" ? "Daily check-in record" : "Industry supervisor review"}
                  </p>
                </div>

                <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs">
                  <p className="text-[10px] font-mono font-medium text-[#7A7973] uppercase tracking-wider">Evaluation Grade</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-[1.5rem] font-extrabold tracking-[-0.035em] text-[#141414]">
                      {dashboard?.metrics.runningScoreAvg && dashboard.metrics.runningScoreAvg > 0
                        ? dashboard.metrics.runningScoreAvg.toFixed(1)
                        : "—"}
                    </span>
                    <span className="text-[11px] text-[#7A7973]">/ 5.0</span>
                  </div>
                  <p className="text-[10.5px] text-[#7A7973] mt-0.5">
                    {dashboard?.weeks && dashboard.weeks.length > 0
                      ? `Across ${dashboard.weeks.length} reviewed weeks`
                      : "Pending coordinator reviews"}
                  </p>
                </div>
              </div>

              {/* Active Week Card (Only displayed if matched) */}
              {isMatched && dashboard?.currentWeek ? (
                <div className="bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#F0EFE9] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-[14px] font-bold text-[#141414]">
                          Current Week &middot; Week {dashboard.currentWeek.weekNumber}
                        </h2>
                        <WeekChip status={dashboard.currentWeek.status} />
                      </div>
                      <p className="text-[11px] text-[#7A7973] mt-0.5">
                        {dashboard.currentWeek.startDate} &ndash; {dashboard.currentWeek.endDate} &middot; Due Saturday at 11:59 PM
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11.5px] text-[#5A5954]">
                        <strong className="text-[#141414]">{filledCount} of {totalWorkingDays}</strong> days filled
                      </span>
                      <div className="w-20 h-1.5 rounded-full bg-[#F0EFE9] overflow-hidden">
                        <div
                          className="h-full bg-[#141414] rounded-full transition-all duration-300"
                          style={{ width: `${(filledCount / (totalWorkingDays || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Daily Tiles Row */}
                  <div className="p-4">
                    {currentDays.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {currentDays.map((d) => (
                          <DayTile key={d.dayShort} {...d} />
                        ))}
                      </div>
                    ) : (
                      <div className="p-6 text-center text-[12px] text-[#7A7973]">
                        Daily entries will appear on the session start date.
                      </div>
                    )}
                  </div>

                  {/* Submit Action Footer */}
                  <div className="px-5 py-3.5 bg-[#FAF9F5] border-t border-[#F0EFE9] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <p className="text-[11px] text-[#7A7973]">
                      {canSubmit
                        ? `All working days for Week ${dashboard.currentWeek.weekNumber} are filled and ready for coordinator review.`
                        : `Complete remaining daily entries to unlock Week ${dashboard.currentWeek.weekNumber} submission.`}
                    </p>
                    <Link
                      href={`/student/week/${dashboard.currentWeek.weekNumber}`}
                      className={`px-4 py-2 rounded-full text-[12px] font-semibold transition-all ${
                        canSubmit
                          ? "bg-[#141414] text-white hover:bg-[#282828] shadow-xs cursor-pointer"
                          : "bg-[#E8E7E1] text-[#7A7973]"
                      }`}
                    >
                      Open Week {dashboard.currentWeek.weekNumber} logbook
                    </Link>
                  </div>
                </div>
              ) : isMatched && !dashboard?.currentWeek ? (
                <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 text-center space-y-2">
                  <Clock className="size-8 text-[#7A7973] mx-auto" />
                  <h3 className="text-[13px] font-bold text-[#141414]">Session Scheduled</h3>
                  <p className="text-[11.5px] text-[#7A7973] max-w-md mx-auto">
                    Your cohort has been scheduled to start on {cohort?.start_date}. Daily logging and weekly submissions will unlock on day 1.
                  </p>
                </div>
              ) : null}

              {/* Lower Grid: Previous Weeks & Feedback */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Column (7 cols): Previous Weeks */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden flex flex-col">
                  <div className="px-5 py-4 border-b border-[#F0EFE9] flex items-center justify-between">
                    <div>
                      <h3 className="text-[13px] font-bold text-[#141414]">Previous Weeks</h3>
                      <p className="text-[11px] text-[#7A7973]">Graded submissions and archived logbooks</p>
                    </div>
                    {dashboard?.weeks && dashboard.weeks.length > 0 && (
                      <span className="text-[11px] font-semibold text-[#141414] flex items-center gap-1">
                        {dashboard.weeks.length} Weeks
                      </span>
                    )}
                  </div>

                  {dashboard?.weeks && dashboard.weeks.length > 0 ? (
                    <div className="divide-y divide-[#F0EFE9] flex-1">
                      {dashboard.weeks.map((w) => (
                        <Link
                          key={w.weekNumber}
                          href={`/student/week/${w.weekNumber}`}
                          className="px-5 py-3.5 flex items-center justify-between hover:bg-[#FAF9F5] transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <span className="size-7 rounded-lg bg-[#F5F4EF] text-[#141414] text-[11px] font-mono font-bold flex items-center justify-center shrink-0 group-hover:bg-[#141414] group-hover:text-white transition-colors">
                              W{w.weekNumber}
                            </span>
                            <div>
                              <p className="text-[12.5px] font-semibold text-[#141414]">Week {w.weekNumber} Logbook</p>
                              <p className="text-[10.5px] text-[#7A7973]">{w.startDate} &ndash; {w.endDate}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <WeekChip status={w.status} />
                            <ChevronRight className="size-3.5 text-[#9A9990] group-hover:text-[#141414] group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
                      <Inbox className="size-6 text-[#9A9990]" />
                      <p className="text-[12.5px] font-semibold text-[#141414]">No submitted weeks yet</p>
                      <p className="text-[11px] text-[#7A7973] max-w-xs">
                        Completed weeks submitted by Saturday midnight will appear here along with their coordinator grades.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Column (5 cols): Coordinator Feedback */}
                <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden flex flex-col">
                  <div className="px-5 py-4 border-b border-[#F0EFE9] flex items-center justify-between">
                    <div>
                      <h3 className="text-[13px] font-bold text-[#141414]">Coordinator Feedback</h3>
                      <p className="text-[11px] text-[#7A7973]">Review grades and commentary</p>
                    </div>
                  </div>

                  {dashboard?.recentFeedback && dashboard.recentFeedback.length > 0 ? (
                    <div className="p-4 space-y-3 flex-1">
                      {dashboard.recentFeedback.map((f, i) => (
                        <div key={i} className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-[#141414] bg-white border border-[#E8E7E1] px-2 py-0.5 rounded">
                              {f.week}
                            </span>
                            <span className="text-[10px] text-[#9A9990]">{f.date}</span>
                          </div>
                          <p className="text-[12px] text-[#5A5954] leading-relaxed">
                            &ldquo;{f.text}&rdquo;
                          </p>
                          <div className="flex items-center justify-between pt-1 border-t border-[#E8E7E1] text-[10.5px]">
                            <span className="text-[#7A7973]">{f.coordinator}</span>
                            {f.rating != null && (
                              <span className="font-semibold text-emerald-700 flex items-center gap-1">
                                <Star className="size-3 fill-emerald-600 text-emerald-600" /> {f.rating}/5.0
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
                      <Star className="size-6 text-[#9A9990]" />
                      <p className="text-[12.5px] font-semibold text-[#141414]">No feedback records yet</p>
                      <p className="text-[11px] text-[#7A7973] max-w-xs">
                        When your coordinator reviews and grades your weekly entries, their feedback comments and ratings will appear here.
                      </p>
                    </div>
                  )}
                </div>

              </div>
            </>
          )}

        </main>
      </div>
    </div>
  );
}
