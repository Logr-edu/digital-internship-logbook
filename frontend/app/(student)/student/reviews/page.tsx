"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, Send, X, Clock, CheckCircle2, AlertCircle,
  Building, Star, Inbox
} from "lucide-react";
import { studentApi, type SupervisorReviewBatchItem } from "@/lib/api/student";

type BatchStatus = "pending" | "reviewed" | "expired";

const BATCH_STATUS: Record<BatchStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:  { label: "Awaiting supervisor", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <Clock className="size-2.5" /> },
  reviewed: { label: "Reviewed & signed",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="size-2.5" /> },
  expired:  { label: "Link expired",        cls: "bg-[#F5F4EF] text-[#7A7973] border-[#E8E7E1]", icon: <AlertCircle className="size-2.5" /> },
};

function SendSheet({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSending(true);
    setError(null);

    const formattedPhone = phone.trim() ? (phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`) : "+2348000000000";

    const res = await studentApi.sendSupervisorBatch({
      supervisorName: name.trim(),
      supervisorEmail: email.trim(),
      companyName: org.trim() || "Workplace Placement",
      phone: formattedPhone,
      weekNumbers: [1, 2, 3, 4],
    });

    setSending(false);
    if (res.ok) {
      setDone(true);
      onSuccess();
    } else {
      setError(res.message || "Failed to dispatch review link. Please verify the email and international phone number.");
    }
  }

  const inputCls = "w-full h-9.5 px-3 rounded-xl border border-[#D8D7CE] bg-white text-[12.5px] text-[#141414] placeholder:text-[#B0AFA9] outline-none transition-all focus:ring-2 focus:ring-[#F04D23]/15 focus:border-[#F04D23]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs">
      <div className="w-full max-w-[420px] bg-white rounded-2xl border border-[#E8E7E1] shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#F0EFE9] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#F04D23]" />
            <h3 className="text-[13px] font-bold text-[#141414]">Send to Workplace Supervisor</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#7A7973] hover:text-[#141414] transition-colors cursor-pointer">
            <X className="size-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <div className="size-10 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
              <CheckCircle2 className="size-5" />
            </div>
            <h4 className="text-[13px] font-bold text-[#141414]">Review Link Sent</h4>
            <p className="text-[12px] text-[#7A7973] max-w-xs mx-auto">
              A review link has been sent to <strong className="text-[#141414]">{email}</strong>. Valid for 72 hours.
            </p>
            <button
              onClick={onClose}
              className="mt-3 w-full py-2 rounded-full bg-[#141414] text-white text-[12px] font-semibold hover:bg-[#282828] transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="p-5 space-y-3.5 overflow-y-auto">
            <p className="text-[11.5px] text-[#5A5954] leading-relaxed">
              Your supervisor will receive a secure review link to evaluate and sign off your entries.
            </p>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[11px] flex items-center gap-1.5">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">Supervisor full name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Engr. Michael Adedipe"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">Work email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. m.adedipe@company.com"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">Company</label>
                <input
                  type="text"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  placeholder="e.g. Engineering Firm"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-[#5A5954] uppercase tracking-wider">Phone (+234...)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+234…"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 rounded-full border border-[#D8D7CE] text-[12px] font-semibold text-[#5A5954] hover:text-[#141414] hover:bg-[#FAF9F5] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="flex-1 py-2 rounded-full bg-[#141414] text-white text-[12px] font-semibold hover:bg-[#282828] transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {sending ? "Sending…" : "Send review request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StudentReviewsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<SupervisorReviewBatchItem[]>([]);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend(batch: SupervisorReviewBatchItem) {
    if (resendingId) return;
    setResendingId(batch.id);
    setResendMessage(null);
    setResendError(null);
    const response = await studentApi.resendSupervisorReview(batch.id);
    setResendingId(null);
    if (response.ok) {
      setResendMessage(`A fresh review link was sent to ${batch.recipientEmail}. Use the newest email; the previous link is no longer valid.`);
      await loadBatches();
    } else {
      setResendError(response.message);
    }
  }

  async function loadBatches() {
    setLoading(true);
    const res = await studentApi.getSupervisorReviews();
    if (res.ok && res.data) {
      setBatches(res.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBatches();
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F4EF] font-sans selection:bg-[#F04D23] selection:text-white text-[#141414] py-8 px-4 sm:px-6">
      {sheetOpen && (
        <SendSheet
          onClose={() => setSheetOpen(false)}
          onSuccess={() => loadBatches()}
        />
      )}

      <div className="max-w-[780px] mx-auto space-y-5">
        {resendMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800">{resendMessage}</p>}
        {resendError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{resendError}</p>}
        
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/student"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#7A7973] hover:text-[#141414] transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Dashboard</span>
          </Link>

          <button
            onClick={() => setSheetOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#141414] text-white text-[11px] font-semibold hover:bg-[#282828] transition-colors shadow-xs cursor-pointer"
          >
            <Send className="size-3.5" />
            <span>Send to supervisor</span>
          </button>
        </div>

        {/* Hero Card */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A7973]">
              SIWES Sign-Off
            </span>
            <h1 className="text-[1.25rem] sm:text-[1.35rem] font-bold tracking-[-0.025em] text-[#141414] mt-0.5">
              Supervisor Reviews
            </h1>
            <p className="text-[11.5px] text-[#7A7973] mt-0.5">
              Track workplace supervisor reviews and signatures for SIWES logbook validation.
            </p>
          </div>

          <div className="bg-[#FAF9F5] p-3 rounded-xl border border-[#E8E7E1] text-[11px] space-y-0.5">
            <p className="text-[#7A7973]">Electronic Verification:</p>
            <p className="font-semibold text-[#141414] flex items-center gap-1.5">
              <Building className="size-3.5 text-[#141414]" /> Industry Placement Portal
            </p>
          </div>
        </div>

        {/* Batches List */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0EFE9] flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-[#141414]">Review Batches</h2>
            <span className="text-[10.5px] text-[#7A7973]">Dispatched by secure link</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-[12px] text-[#7A7973]">Loading review batches…</div>
          ) : batches.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <div className="size-10 rounded-full bg-[#F5F4EF] text-[#7A7973] mx-auto flex items-center justify-center">
                <Inbox className="size-5" />
              </div>
              <p className="text-[13px] font-semibold text-[#141414]">No review batches sent yet</p>
              <p className="text-[11.5px] text-[#7A7973] max-w-sm mx-auto">
                Once you complete and submit weekly logbook entries, you can dispatch review batches to your industry workplace supervisor for digital sign-off.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0EFE9]">
              {batches.map((batch) => {
                const statusConfig = BATCH_STATUS[batch.status] || BATCH_STATUS.pending;
                const formattedDate = new Date(batch.sentAt).toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                });

                return (
                  <div key={batch.id} className="p-4 sm:p-5 space-y-3 hover:bg-[#FAF9F5] transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[13px] font-bold text-[#141414]">{batch.batchLabel}</h3>
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusConfig.cls}`}>
                            {statusConfig.icon}
                            <span>{statusConfig.label}</span>
                          </span>
                        </div>
                        <p className="text-[10.5px] text-[#7A7973] mt-0.5">
                          Sent {formattedDate} &middot; {batch.recipientName} ({batch.companyName})
                        </p>
                      </div>

                      {batch.rating && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 self-start sm:self-center">
                          <Star className="size-2.5 fill-emerald-600 text-emerald-600" /> Rated {batch.rating}/5
                        </span>
                      )}
                    </div>

                    {(batch.status === "pending" || batch.status === "expired") && (
                      <button type="button" disabled={resendingId !== null}
                        onClick={() => handleResend(batch)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#141414] px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#282828] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        <Send className="size-3.5" />
                        {resendingId === batch.id ? "Sending…" : "Resend review link"}
                      </button>
                    )}

                    {batch.feedback && (
                      <div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] text-[12px] text-[#5A5954] leading-relaxed italic">
                        &ldquo;{batch.feedback}&rdquo;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
