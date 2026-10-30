"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search, BookOpen, ChevronRight, AlertCircle,
  Clock, CheckCircle2, Star, Award
} from "lucide-react";
import { CoordinatorShell } from "@/components/coordinator/CoordinatorShell";
import { StudentsListSkeleton } from "@/components/coordinator/CoordinatorSkeletons";
import { coordinatorApi, type CoordinatorStudentSummary } from "@/lib/api/coordinator";

function CoordinatorStudentsList() {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<CoordinatorStudentSummary[]>([]);
  const [query, setQuery] = useState("");
  const requestedFilter = params.get("filter") ?? "all";
  const filter = ["needs_review", "extension_pending", "overdue"].includes(requestedFilter)
    ? requestedFilter : "all";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await coordinatorApi.getStudents(query, filter);
      if (!mounted) return;
      if (res.ok) setStudents(res.data);
      else { setStudents([]); setError(res.message); }
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [query, filter]);

  return (
    <CoordinatorShell
      title={filter === "needs_review" ? "Weekly Reviews" : "Students"}
      activeHref={filter === "needs_review" ? "/coordinator/students?filter=needs_review" : "/coordinator/students"}
      subtitle="Enrolled students, submission status, and running grades"
    >
      <div className="space-y-6">
        
        {/* Search & Filter Header Strip */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 size-4 text-[#9A9990]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by matric number or name…"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-[#D8D7CE] bg-white text-[12.5px] text-[#141414] placeholder:text-[#B0AFA9] outline-none transition-all focus:ring-2 focus:ring-[#F04D23]/15 focus:border-[#F04D23]"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "all", label: "All" },
              { id: "needs_review", label: "Needs review" },
              { id: "extension_pending", label: "Extension requests" },
              { id: "overdue", label: "Overdue" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  const next = new URLSearchParams(params.toString());
                  if (tab.id === "all") next.delete("filter");
                  else next.set("filter", tab.id);
                  const suffix = next.toString();
                  router.replace(`/coordinator/students${suffix ? `?${suffix}` : ""}`, { scroll: false });
                }}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors shrink-0 cursor-pointer ${
                  filter === tab.id
                    ? "bg-[#141414] text-white"
                    : "border border-[#D8D7CE] text-[#5A5954] hover:bg-[#FAF9F5] hover:text-[#141414]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State or Students Grid */}
        {loading ? (
          <StudentsListSkeleton />
        ) : error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700">{error}</p>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E8E7E1] p-12 text-center space-y-2">
            <BookOpen className="size-8 text-[#9A9990] mx-auto" />
            <h3 className="text-[14px] font-bold text-[#141414]">No students found</h3>
            <p className="text-[12px] text-[#7A7973]">
              No student records matched your search or filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {students.map((student) => {
              const progressPct = Math.round((student.weeksSubmitted / student.totalWeeks) * 100);
              
              return (
                <Link
                  key={student.id}
                  href={`/coordinator/students/${student.id}`}
                  className="bg-white rounded-2xl border border-[#E8E7E1] p-5 shadow-xs hover:border-[#D8D7CE] hover:shadow-sm transition-all group flex flex-col justify-between"
                >
                  {/* Top card info */}
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        {/* Student Avatar */}
                        <div className="size-10 rounded-xl bg-amber-100/80 border border-amber-300 text-amber-900 font-bold text-[12px] flex items-center justify-center shrink-0">
                          {student.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <h3 className="text-[13px] font-bold text-[#141414] group-hover:text-[#F04D23] transition-colors truncate">
                            {student.name}
                          </h3>
                          <p className="text-[10.5px] text-[#7A7973] font-mono">{student.matricNo}</p>
                        </div>
                      </div>

                      {/* Status Badges */}
                      {student.status === "needs_review" ? (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                          <Clock className="size-2.5" /> {student.pendingReviewCount} to review
                        </span>
                      ) : student.status === "extension_pending" ? (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                          Extension request
                        </span>
                      ) : student.status === "overdue" ? (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 shrink-0">
                          Overdue
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          Up to date
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1 pt-2 border-t border-[#F0EFE9]">
                      <div className="flex justify-between text-[10.5px] text-[#7A7973]">
                        <span>Logbook progress</span>
                        <span className="font-semibold text-[#141414]">
                          {student.weeksSubmitted} of {student.totalWeeks} weeks
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#F0EFE9] overflow-hidden">
                        <div
                          className="h-full bg-[#141414] rounded-full transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Running Score Average & Link */}
                  <div className="flex items-center justify-between pt-4 mt-3 border-t border-[#F0EFE9] text-[11px]">
                    <div className="flex items-center gap-1 text-[#5A5954]">
                      <Award className="size-3.5 text-amber-600" />
                      <span>Average: <strong className="text-[#141414]">{student.runningScoreAvg == null ? "Not yet graded" : `${student.runningScoreAvg} / 5`}</strong></span>
                    </div>

                    <span className="inline-flex items-center gap-0.5 font-semibold text-[#141414] group-hover:translate-x-0.5 transition-transform">
                      View logbook <ChevronRight className="size-3" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

      </div>
    </CoordinatorShell>
  );
}

export default function CoordinatorStudentsPage() {
  return (
    <Suspense fallback={<StudentsListSkeleton />}>
      <CoordinatorStudentsList />
    </Suspense>
  );
}
