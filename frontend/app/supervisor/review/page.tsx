"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building, Star, CheckCircle2, Clock, AlertCircle,
  FileText, ShieldCheck, ChevronDown, ChevronUp, Send, Check
} from "lucide-react";
import { supervisorApi, type SupervisorReviewBatchData } from "@/lib/api/supervisor";

export default function SupervisorReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const unwrappedParams = use(searchParams);
  const token = unwrappedParams.token || "";
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<SupervisorReviewBatchData | null>(null);
  const [errorState, setErrorState] = useState<string | null>(null);

  // Form states
  const [expandedWeek, setExpandedWeek] = useState<number | null>(3);
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorRole, setSupervisorRole] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState<number>(5);
  const [signatureType] = useState<"typed" | "drawn">("typed");
  const [signatureName, setSignatureName] = useState("");
  const [confirmationAgreed, setConfirmationAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setErrorState("invalid_token");
      setLoading(false);
      return;
    }
    async function load() {
      const res = await supervisorApi.getReviewBatch(token);
      if (!mounted) return;
      if (res.ok) {
        setBatch(res.data);
        if (res.data.weeks.length > 0) {
          setExpandedWeek(res.data.weeks[0].weekNumber);
        }
      } else {
        setErrorState(res.code ?? (res.status === 0 ? "connection_error" : "load_failed"));
      }
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!supervisorName.trim()) {
      setFormError("Enter your full name.");
      return;
    }
    if (!supervisorRole.trim()) {
      setFormError("Enter your job title or position.");
      return;
    }
    if (reviewText.trim().length < 20) {
      setFormError("Written evaluation must be at least 20 characters.");
      return;
    }
    if (!signatureName.trim()) {
      setFormError("Type your name to sign this review.");
      return;
    }
    if (!confirmationAgreed) {
      setFormError("Confirm the declaration before submitting.");
      return;
    }

    setSubmitting(true);
    const res = await supervisorApi.submitReview({
      token,
      supervisorName,
      supervisorRole,
      reviewText,
      rating,
      signatureType,
      signatureValue: signatureName,
      confirmationAgreed,
    });
    setSubmitting(false);

    if (res.ok) {
      router.push(`/supervisor/done?name=${encodeURIComponent(supervisorName)}&student=${encodeURIComponent(batch?.studentName || "the student")}`);
    } else {
      setFormError(res.message || "Unable to submit review. Check your connection and try again.");
    }
  }

  const inputCls = "w-full h-10 px-3.5 rounded-xl border border-[#D8D7CE] bg-white text-[12.5px] text-[#141414] placeholder:text-[#B0AFA9] outline-none transition-all focus:ring-2 focus:ring-[#F04D23]/15 focus:border-[#F04D23]";

  return (
    <div className="min-h-screen bg-[#F5F4EF] font-sans selection:bg-[#F04D23] selection:text-white text-[#141414] py-8 px-4 sm:px-6">
      <div className="max-w-[760px] mx-auto space-y-6">
        
        {/* Brand Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#D8D7CE]">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#F04D23]" />
            <span className="text-[17px] font-extrabold tracking-[-0.03em] text-[#141414]">Logr</span>
            <span className="text-[11px] text-[#7A7973] font-normal ml-0.5">/ Workplace Supervisor Review</span>
          </div>
          <span className="text-[10px] font-mono text-[#7A7973] uppercase tracking-wider bg-white border border-[#E8E7E1] px-2.5 py-1 rounded-full">
            SIWES Review
          </span>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 space-y-3 text-center">
            <div className="size-7 rounded-full border-2 border-[#141414] border-t-transparent animate-spin mx-auto" />
            <p className="text-[12px] text-[#7A7973]">Loading review details…</p>
          </div>
        ) : errorState === "token_expired" || errorState === "link_expired" ? (
          /* Expired Link State */
          <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 text-center space-y-3 shadow-xs">
            <div className="size-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto border border-amber-200">
              <Clock className="size-6" />
            </div>
            <h2 className="text-[15px] font-bold text-[#141414]">Review Link Expired</h2>
            <p className="text-[12.5px] text-[#5A5954] max-w-md mx-auto leading-relaxed">
              This review link is no longer valid. Contact the student to request a new review link.
            </p>
          </div>
        ) : errorState !== "already_submitted" && !batch ? (
          /* Invalid Link State */
          <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 text-center space-y-3 shadow-xs">
            <div className="size-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
              <AlertCircle className="size-6" />
            </div>
            <h2 className="text-[15px] font-bold text-[#141414]">{errorState === "invalid_token" || errorState === "token_invalid" ? "Invalid Review Link" : "Unable to Load Review"}</h2>
            <p className="text-[12.5px] text-[#5A5954] max-w-md mx-auto leading-relaxed">
              {errorState === "invalid_token" || errorState === "token_invalid"
                ? "This link is invalid or incomplete. Open the latest review email or ask the student to resend the request."
                : errorState === "throttled"
                  ? "This review link has been opened too often. Please try again later."
                  : "We could not load the review. Check your connection and try again. This does not mean your link is invalid."}
            </p>
          </div>
        ) : errorState === "already_submitted" || batch?.isCompleted ? (
          /* Already Completed State */
          <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 text-center space-y-3 shadow-xs">
            <div className="size-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle2 className="size-6" />
            </div>
            <h2 className="text-[15px] font-bold text-[#141414]">Review Already Submitted</h2>
            <p className="text-[12.5px] text-[#5A5954] max-w-md mx-auto leading-relaxed">
              This logbook review has already been submitted. No further action is needed.
            </p>
          </div>
        ) : batch ? (
          /* Valid Active Review Form */
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Student Overview Card */}
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 sm:p-6 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A7973]">
                  Student Details
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0EFE9]">
                <div>
                  <h1 className="text-[1.25rem] sm:text-[1.35rem] font-bold tracking-[-0.025em] text-[#141414]">
                    {batch.studentName}
                  </h1>
                  <p className="text-[11.5px] text-[#7A7973] font-mono mt-0.5">
                    {batch.matricNo} &middot; {batch.department} &middot; Obafemi Awolowo University
                  </p>
                </div>

                <div className="text-left sm:text-right text-[11px] text-[#7A7973] bg-[#FAF9F5] p-2.5 rounded-xl border border-[#E8E7E1]">
                  <p className="font-semibold text-[#141414]">{batch.companyName}</p>
                  <p className="text-[10px]">SIWES placement</p>
                </div>
              </div>

              <p className="text-[12px] text-[#5A5954] leading-relaxed">
                Review the daily logbook entries recorded by the student and submit your evaluation below.
              </p>
            </div>

            {/* Submitted Weeks Inspection Accordion */}
            <div className="space-y-3">
              <h2 className="text-[13px] font-bold text-[#141414]">Submitted Work</h2>

              {batch.weeks.map((week) => {
                const isOpen = expandedWeek === week.weekNumber;
                const days = week.days ?? week.entries ?? [];
                return (
                  <div
                    key={week.weekNumber}
                    className="bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden"
                  >
                    {/* Week Header Toggle */}
                    <button
                      type="button"
                      onClick={() => setExpandedWeek(isOpen ? null : week.weekNumber)}
                      className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#FAF9F5] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <span className="size-7 rounded-lg bg-[#F5F4EF] text-[#141414] text-[11px] font-mono font-bold flex items-center justify-center shrink-0">
                          W{week.weekNumber}
                        </span>
                        <div>
                          <p className="text-[13px] font-bold text-[#141414]">Week {week.weekNumber}</p>
                          <p className="text-[10.5px] text-[#7A7973]">{week.dates ?? `Week ${week.weekNumber}`} &middot; {days.length} working days recorded</p>
                        </div>
                      </div>

                      {isOpen ? (
                        <ChevronUp className="size-4 text-[#7A7973]" />
                      ) : (
                        <ChevronDown className="size-4 text-[#7A7973]" />
                      )}
                    </button>

                    {/* Week Daily Entries List */}
                    {isOpen && (
                      <div className="divide-y divide-[#F0EFE9] border-t border-[#F0EFE9] bg-[#FAF9F5]/40">
                        {days.map((day) => (
                          <div key={day.date} className="p-4 sm:p-5 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12.5px] font-bold text-[#141414]">
                                {day.dayName ? `${day.dayName} · ` : ""}{day.date}
                              </span>
                              <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                Completed
                              </span>
                            </div>

                            <div className="space-y-1">
                              <p className="text-[10px] font-mono uppercase text-[#7A7973]">Tasks & Activities</p>
                              <p className="text-[12px] text-[#3A3934] leading-relaxed bg-white p-3 rounded-xl border border-[#E8E7E1]">
                                {day.activities}
                              </p>
                            </div>

                            {day.skills && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-mono uppercase text-[#7A7973]">Tools & Skills</p>
                                <p className="text-[11.5px] text-[#5A5954] font-mono bg-white p-2.5 rounded-xl border border-[#E8E7E1]">
                                  {day.skills}
                                </p>
                              </div>
                            )}

                            {(day.reflection || day.studentReview) && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-mono uppercase text-[#7A7973]">Student Reflection</p>
                                <p className="text-[11.5px] text-[#5A5954] italic bg-white p-2.5 rounded-xl border border-[#E8E7E1]">
                                  &ldquo;{day.reflection || day.studentReview}&rdquo;
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Supervisor Assessment Form */}
            <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 sm:p-6 shadow-xs space-y-5">
              <div className="pb-2 border-b border-[#F0EFE9]">
                <h2 className="text-[13px] font-bold text-[#141414]">Supervisor Evaluation</h2>
                <p className="text-[11px] text-[#7A7973]">Your evaluation will be submitted to the student&apos;s department coordinator.</p>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11.5px] font-semibold flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Supervisor Info Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">
                    Supervisor Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={supervisorName}
                    onChange={(e) => setSupervisorName(e.target.value)}
                    placeholder="e.g. Engr. Michael Adedipe"
                    className={inputCls}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">
                    Job Title / Position *
                  </label>
                  <input
                    type="text"
                    required
                    value={supervisorRole}
                    onChange={(e) => setSupervisorRole(e.target.value)}
                    placeholder="e.g. Senior Systems Engineer"
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Written Review Textarea */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">
                  Written Evaluation * <span className="font-normal text-[#9A9990]">(minimum 20 characters)</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="Summarize the student's work performance, punctuality, and technical progress during this period…"
                  className="w-full p-3.5 rounded-xl border border-[#D8D7CE] bg-white text-[12.5px] text-[#141414] placeholder:text-[#B0AFA9] outline-none transition-all focus:ring-2 focus:ring-[#F04D23]/15 focus:border-[#F04D23]"
                />
              </div>

              {/* Performance Rating */}
              <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] space-y-2">
                <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider block">
                  Overall Rating
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setRating(score)}
                      className={`size-8.5 rounded-lg text-[12px] font-bold transition-all flex items-center justify-center cursor-pointer ${
                        rating === score
                          ? "bg-[#141414] text-white shadow-xs"
                          : "bg-white border border-[#D8D7CE] text-[#5A5954] hover:bg-white"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                  <span className="text-[11px] text-[#7A7973] ml-2">
                    {rating === 5 ? "Excellent" : rating === 4 ? "Good" : rating === 3 ? "Satisfactory" : rating === 2 ? "Needs improvement" : "Unsatisfactory"}
                  </span>
                </div>
              </div>

              {/* Signature & Confirmation */}
              <div className="space-y-3 pt-2 border-t border-[#F0EFE9]">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">
                    Digital Signature *
                  </label>
                  <input
                    type="text"
                    required
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="Type your full name to sign this review"
                    className={inputCls}
                  />
                </div>

                <label className="flex items-start gap-2.5 text-[11.5px] text-[#5A5954] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={confirmationAgreed}
                    onChange={(e) => setConfirmationAgreed(e.target.checked)}
                    className="size-4 rounded border-[#D8D7CE] text-[#141414] focus:ring-0 mt-0.5"
                  />
                  <span>
                    I confirm that I supervised this student during this period and that this evaluation is an accurate assessment of their work.
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-full bg-[#141414] text-white text-[12px] font-semibold hover:bg-[#282828] transition-colors shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Send className="size-3.5" />
                  <span>{submitting ? "Submitting review…" : "Submit review"}</span>
                </button>
              </div>

            </div>

          </form>
        ) : null}

      </div>
    </div>
  );
}
