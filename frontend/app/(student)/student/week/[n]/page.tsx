"use client";

import { useState, use, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, ChevronRight, Lock, AlertCircle, Star,
  CheckCircle2, Clock, Send, Calendar, HelpCircle, X,
  Inbox
} from "lucide-react";
import { studentApi, type DayStatus, type WeekStatus, type StudentDayData, type RequestExtensionPayload } from "@/lib/api/student";

function DayStatusBadge({ status }: { status: DayStatus }) {
  const map: Record<DayStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    ready:     { label: "Ready",        cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <CheckCircle2 className="size-2.5" /> },
    draft:     { label: "Draft",        cls: "bg-[#F5F4EF] text-[#7A7973] border-[#E8E7E1]", icon: <Clock className="size-2.5" /> },
    empty:     { label: "Empty",        cls: "bg-[#F5F4EF] text-[#9A9990] border-[#E8E7E1]" },
    submitted: { label: "Submitted",    cls: "bg-[#F5F4EF] text-[#5A5954] border-[#E8E7E1]", icon: <Lock className="size-2.5" /> },
    reviewed:  { label: "Reviewed",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <Star className="size-2.5" /> },
    returned:  { label: "Returned",     cls: "bg-orange-50 text-orange-700 border-orange-200", icon: <AlertCircle className="size-2.5" /> },
    future:    { label: "Upcoming",     cls: "text-[#C0BFB9] border-transparent bg-transparent" },
    holiday:   { label: "Holiday",      cls: "text-[#C0BFB9] border-transparent bg-transparent" },
  };
  const { label, cls, icon } = map[status] || { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md border ${cls}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function WeekStatusBadge({ status }: { status: WeekStatus }) {
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
    <span className={`inline-flex items-center text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

export default function StudentWeekPage({ params }: { params: Promise<{ n: string }> }) {
  const unwrappedParams = use(params);
  const weekNum = parseInt(unwrappedParams.n, 10) || 1;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [weekStatus, setWeekStatus] = useState<WeekStatus>("in_progress");
  const [days, setDays] = useState<StudentDayData[]>([]);
  const [dates, setDates] = useState("");
  const [filledCount, setFilledCount] = useState(0);
  const [requiredDays, setRequiredDays] = useState(0);
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Extension Appeal Modal State
  const [appealModalOpen, setAppealModalOpen] = useState(false);
  const [appealReason, setAppealReason] = useState<RequestExtensionPayload["reason"]>("medical");
  const [appealGraceDays, setAppealGraceDays] = useState(3);
  const [appealNotes, setAppealNotes] = useState("");
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealSuccessMsg, setAppealSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadWeek() {
      setLoading(true);
      const res = await studentApi.getWeek(weekNum);
      if (res.ok && res.data) {
        setWeekStatus(res.data.status);
        setDays(res.data.days);
        setFilledCount(res.data.filledDays);
        setRequiredDays(res.data.totalDays);
        setCanSubmit(res.data.canSubmit === true);
        if (res.data.startDate && res.data.endDate) {
          setDates(`${res.data.startDate} – ${res.data.endDate}`);
        }
      }
      setLoading(false);
    }
    loadWeek();
  }, [weekNum]);

  const isSubmissionReady = canSubmit && requiredDays > 0 && weekStatus !== "submitted" && weekStatus !== "reviewed";

  async function handleSubmitWeek() {
    if (!isSubmissionReady) return;
    setSubmitError(null);
    setSubmitting(true);
    const res = await studentApi.submitWeek(weekNum);
    setSubmitting(false);
    if (res.ok) {
      setSubmitSuccess(true);
      setWeekStatus("submitted");
      setCanSubmit(false);
    } else {
      setSubmitError(res.message);
    }
  }

  async function handleAppealSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appealNotes.trim()) return;
    setAppealSubmitting(true);
    const res = await studentApi.requestWeekExtension(weekNum, {
      reason: appealReason,
      graceDays: appealGraceDays,
      notes: appealNotes,
    });
    setAppealSubmitting(false);
    if (res.ok) {
      setAppealSuccessMsg("Your extension request was sent to the faculty coordinator.");
      setTimeout(() => {
        setAppealModalOpen(false);
        setAppealSuccessMsg(null);
      }, 2000);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F4EF] font-sans selection:bg-[#F04D23] selection:text-white text-[#141414] py-8 px-4 sm:px-6">
      <div className="max-w-[880px] mx-auto space-y-5">
        {submitError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{submitError}</p>}
        
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/student"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#7A7973] hover:text-[#141414] transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Dashboard</span>
          </Link>

          <div className="flex items-center gap-2 text-[11px] text-[#7A7973]">
            <span>Logbook Cycle</span>
            <span>&middot;</span>
            <span className="font-semibold text-[#141414]">Week {weekNum}</span>
          </div>
        </div>

        {/* Hero Card */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[1.25rem] sm:text-[1.35rem] font-bold tracking-[-0.025em] text-[#141414]">
                Week {weekNum} Logbook
              </h1>
              <WeekStatusBadge status={weekStatus} />
            </div>
            <p className="text-[11.5px] text-[#7A7973] mt-0.5">
              {dates ? `${dates} · Due Saturday at 11:59 PM` : "Weekly work log and reflections"}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[11.5px] text-[#5A5954]">
                <strong className="text-[#141414]">{filledCount} of {requiredDays}</strong> days recorded
              </span>
              <div className="w-16 h-1.5 rounded-full bg-[#F0EFE9] overflow-hidden">
                <div
                  className="h-full bg-[#141414] rounded-full transition-all"
                  style={{ width: `${requiredDays > 0 ? Math.min(100, (filledCount / requiredDays) * 100) : 0}%` }}
                />
              </div>
            </div>

            {/* Appeal extension link button */}
            <button
              onClick={() => setAppealModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7A7973] hover:text-[#141414] border border-[#D8D7CE] px-2.5 py-1 rounded-full transition-colors cursor-pointer"
            >
              <Calendar className="size-3" />
              <span>Request extension</span>
            </button>
          </div>
        </div>

        {/* Success Alert if submitted */}
        {submitSuccess && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
            <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12.5px] font-bold">Week {weekNum} submitted successfully</p>
              <p className="text-[11.5px] text-emerald-800 mt-0.5">
                Your entries have been locked and submitted for coordinator evaluation.
              </p>
            </div>
          </div>
        )}

        {/* Days List */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0EFE9] flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-[#141414]">Daily Entries</h2>
            <span className="text-[10.5px] text-[#7A7973]">Select a day to view or edit</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-[12px] text-[#7A7973]">Loading daily entries…</div>
          ) : days.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Inbox className="size-6 text-[#9A9990] mx-auto" />
              <p className="text-[13px] font-semibold text-[#141414]">No daily entries found for this week</p>
              <p className="text-[11.5px] text-[#7A7973] max-w-sm mx-auto">
                Daily entries are automatically generated based on your cohort working days.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0EFE9]">
              {days.map((day) => {
                const isLocked = day.status === "future" || day.status === "holiday";
                const isReadOnly = weekStatus === "submitted" || weekStatus === "reviewed"
                  || day.status === "submitted" || day.status === "reviewed" || day.editable === false;
                return (
                  <div
                    key={day.date}
                    className={`p-4 sm:p-5 transition-colors ${
                      isLocked ? "bg-[#FAF9F5]/40 opacity-60" : "hover:bg-[#FAF9F5]"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        <div className="size-10 rounded-xl bg-[#F5F4EF] border border-[#E8E7E1] flex flex-col items-center justify-center shrink-0">
                          <span className="text-[9px] font-mono font-medium text-[#7A7973] uppercase">{day.dayShort}</span>
                          <span className="text-[12px] font-bold text-[#141414] leading-tight">{day.date.split("-")[2]}</span>
                        </div>

                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-[13px] font-bold text-[#141414]">{day.dayName}</h3>
                            <span className="text-[10px] text-[#9A9990] font-mono">{day.date}</span>
                            <DayStatusBadge status={day.status} />
                            {day.rating != null && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                <Star className="size-2.5 fill-emerald-600 text-emerald-600" />
                                {day.rating}/5
                              </span>
                            )}
                          </div>

                          {day.activities ? (
                            <p className="text-[12px] text-[#5A5954] line-clamp-2 leading-relaxed">
                              {day.activities}
                            </p>
                          ) : (
                            <p className="text-[11.5px] text-[#9A9990] italic">
                              {day.status === "holiday" ? "Public holiday" : day.status === "future" ? "Upcoming work day" : "No entry written yet."}
                            </p>
                          )}

                          {day.skills && (
                            <p className="text-[11px] font-mono text-[#7A7973] truncate">
                              Skills: {day.skills}
                            </p>
                          )}

                          {day.coordinatorComment && (
                            <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/60 text-[11px] text-amber-950 mt-1.5">
                              <strong>Coordinator note:</strong> &ldquo;{day.coordinatorComment}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                        {isLocked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#9A9990] px-3 py-1.5">
                            <Lock className="size-3" /> Locked
                          </span>
                        ) : (
                          <Link
                            href={`/student/day/${day.date}`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#D8D7CE] hover:border-[#141414] text-[11.5px] font-semibold text-[#141414] hover:bg-white transition-all shadow-2xs"
                          >
                            <span>{isReadOnly ? "View log" : day.activities ? "Edit log" : "Write log"}</span>
                            <ChevronRight className="size-3.5" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Submit Week Action Footer */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-[13px] font-bold text-[#141414]">Submit Week {weekNum}</h3>
            <p className="text-[11px] text-[#7A7973] mt-0.5">
              {weekStatus === "submitted" || weekStatus === "reviewed"
                ? "This week has been submitted for assessment."
                : isSubmissionReady
                ? "All working days are completed. You can now submit this week."
                : `Fill all ${requiredDays} scheduled working days to unlock week submission (${filledCount}/${requiredDays} completed).`}
            </p>
          </div>

          <button
            onClick={handleSubmitWeek}
            disabled={!isSubmissionReady || submitting}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-semibold transition-all shadow-xs ${
              isSubmissionReady && !submitting
                ? "bg-[#141414] text-white hover:bg-[#282828] cursor-pointer"
                : "bg-[#E8E7E1] text-[#9A9990] cursor-not-allowed"
            }`}
          >
            <Send className="size-3.5" />
            <span>{submitting ? "Submitting…" : `Submit Week ${weekNum}`}</span>
          </button>
        </div>

      </div>

      {/* Extension Appeal Modal */}
      {appealModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E8E7E1] max-w-[460px] w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-[#141414]">Request Deadline Extension</h3>
              <button
                onClick={() => setAppealModalOpen(false)}
                className="p-1 text-[#7A7973] hover:text-[#141414]"
              >
                <X className="size-4" />
              </button>
            </div>

            {appealSuccessMsg ? (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[12px] flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <span>{appealSuccessMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleAppealSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[#5A5954] mb-1">
                    Reason category
                  </label>
                  <select
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value as RequestExtensionPayload["reason"])}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8D7CE] bg-white text-[12px] text-[#141414] outline-none focus:border-[#F04D23]"
                  >
                    <option value="medical">Medical illness or hospitalization</option>
                    <option value="technical">Technical outage or device failure</option>
                    <option value="workplace_emergency">Workplace operational emergency</option>
                    <option value="university_event">Official university academic event</option>
                    <option value="other">Other documented circumstance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#5A5954] mb-1">
                    Requested extension period
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 5, 7].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setAppealGraceDays(days)}
                        className={`flex-1 py-1.5 rounded-xl text-[11.5px] font-medium border transition-colors ${
                          appealGraceDays === days
                            ? "bg-[#141414] text-white border-[#141414]"
                            : "bg-white text-[#5A5954] border-[#D8D7CE] hover:border-[#141414]"
                        }`}
                      >
                        +{days} {days === 1 ? "day" : "days"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#5A5954] mb-1">
                    Circumstance explanation
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={appealNotes}
                    onChange={(e) => setAppealNotes(e.target.value)}
                    placeholder="Provide details explaining the delay for your coordinator to assess."
                    className="w-full p-3 rounded-xl border border-[#D8D7CE] bg-white text-[12px] text-[#141414] placeholder:text-[#A0A09A] outline-none focus:border-[#F04D23]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[#F0EFE9]">
                  <button
                    type="button"
                    onClick={() => setAppealModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-full border border-[#D8D7CE] text-[11.5px] font-semibold text-[#5A5954] hover:bg-[#F5F4EF]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={appealSubmitting || !appealNotes.trim()}
                    className="px-4 py-1.5 rounded-full bg-[#141414] text-white text-[11.5px] font-semibold hover:bg-[#282828] disabled:opacity-50 cursor-pointer"
                  >
                    {appealSubmitting ? "Submitting…" : "Send request"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
