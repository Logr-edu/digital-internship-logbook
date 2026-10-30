"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, BookOpen, Star, Calendar, ChevronRight,
  Clock, CheckCircle2, AlertCircle, Award, User
} from "lucide-react";
import { CoordinatorShell } from "@/components/coordinator/CoordinatorShell";
import { SkeletonBlock } from "@/components/coordinator/CoordinatorSkeletons";
import { coordinatorApi, type CoordinatorStudentSummary } from "@/lib/api/coordinator";

export default function CoordinatorStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const studentId = unwrappedParams.id;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<(CoordinatorStudentSummary & {
    weeks: Array<{
      weekNumber: number;
      dates: string;
      status: "reviewed" | "submitted" | "in_progress" | "overdue" | "missed";
      score?: number;
      feedback?: string;
    }>;
  }) | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const res = await coordinatorApi.getStudentDetail(studentId);
      if (!mounted) return;
      if (res.ok) {
        setData(res.data);
      }
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [studentId]);

  return (
    <CoordinatorShell
      title="Student Logbook"
      subtitle={data ? `${data.name} · ${data.matricNo}` : "Loading student profile…"}
    >
      <div className="space-y-6">
        
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/coordinator/students"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#7A7973] hover:text-[#141414] transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>All students</span>
          </Link>
        </div>

        {loading || !data ? (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-6 space-y-3">
              <SkeletonBlock className="h-7 w-60" />
              <SkeletonBlock className="h-4 w-40" />
            </div>
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-6 space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex justify-between py-3 border-b border-[#F0EFE9]">
                  <SkeletonBlock className="h-4 w-32" />
                  <SkeletonBlock className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Student Profile Header Card */}
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="size-12 rounded-2xl bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[14px] flex items-center justify-center shrink-0">
                  {data.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-[1.25rem] sm:text-[1.35rem] font-bold tracking-[-0.025em] text-[#141414]">
                      {data.name}
                    </h1>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {data.programme} Student
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#7A7973] font-mono mt-0.5">
                    {data.matricNo} &middot; {data.department}
                  </p>
                </div>
              </div>

              {/* Running Score Metric */}
              <div className="flex items-center gap-3 bg-[#FAF9F5] p-3 rounded-xl border border-[#E8E7E1]">
                <div className="text-right">
                  <p className="text-[9.5px] font-mono text-[#7A7973] uppercase">Average Score</p>
                  <p className="text-[1.4rem] font-extrabold tracking-tight text-[#141414] leading-none">
                    {data.runningScoreAvg == null ? "Not yet graded" : `${data.runningScoreAvg} / 5`}
                  </p>
                  <p className="text-[10px] text-[#7A7973] mt-0.5">from graded weeks</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-[#141414] text-white flex items-center justify-center font-bold text-[12px]">
                  <Award className="size-5" />
                </div>
              </div>
            </div>

            {/* Weeks List */}
            <div className="bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#F0EFE9] flex items-center justify-between">
                <h2 className="text-[13px] font-bold text-[#141414]">Weekly Submissions</h2>
                <span className="text-[10.5px] text-[#7A7973]">{data.weeks.length} weeks scheduled</span>
              </div>

              <div className="divide-y divide-[#F0EFE9]">
                {data.weeks.map((w) => (
                  <div
                    key={w.weekNumber}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#FAF9F5] transition-colors"
                  >
                    <div className="flex items-center gap-3.5">
                      <span className="size-8 rounded-lg bg-[#F5F4EF] text-[#141414] text-[11px] font-mono font-bold flex items-center justify-center shrink-0">
                        W{w.weekNumber}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-[#141414]">Week {w.weekNumber}</p>
                          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            w.status === "reviewed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : w.status === "submitted"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-[#F5F4EF] text-[#7A7973] border-[#E8E7E1]"
                          }`}>
                            {w.status === "reviewed" ? "Reviewed" : w.status === "submitted" ? "Awaiting review" : "In progress"}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#7A7973]">{w.dates}</p>
                        {w.feedback && (
                          <p className="text-[11.5px] text-[#5A5954] italic mt-1">&ldquo;{w.feedback}&rdquo;</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-start sm:self-center">
                      {w.score != null && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <Star className="size-3 fill-emerald-600 text-emerald-600" /> {w.score}/5.0
                        </span>
                      )}

                      <Link
                        href={`/coordinator/review/sub-${data.id}-w${w.weekNumber}`}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full border border-[#D8D7CE] text-[11px] font-semibold text-[#141414] hover:bg-white transition-all shadow-xs"
                      >
                        <span>{w.status === "submitted" ? "Review week" : "View week"}</span>
                        <ChevronRight className="size-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </CoordinatorShell>
  );
}
