"use client";

import { use } from "react";
import { CheckCircle2 } from "lucide-react";

export default function SupervisorDonePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; student?: string }>;
}) {
  const unwrappedParams = use(searchParams);
  const supervisorName = unwrappedParams.name || "Supervisor";
  const studentName = unwrappedParams.student || "the student";

  return (
    <div className="min-h-screen bg-[#F5F4EF] font-sans selection:bg-[#F04D23] selection:text-white text-[#141414] py-12 px-4 sm:px-6">
      <div className="max-w-[520px] mx-auto space-y-6">
        
        {/* Brand Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#D8D7CE]">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#F04D23]" />
            <span className="text-[17px] font-extrabold tracking-[-0.03em] text-[#141414]">Logr</span>
            <span className="text-[11px] text-[#7A7973] font-normal ml-0.5">/ Confirmation</span>
          </div>
        </div>

        {/* Confirmation Card */}
        <div className="bg-white rounded-2xl border border-[#E8E7E1] p-8 shadow-xs text-center space-y-4">
          <div className="size-12 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="size-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-[1.35rem] font-bold tracking-tight text-[#141414]">
              Review Submitted
            </h1>
            <p className="text-[12.5px] text-[#5A5954] leading-relaxed">
              Thank you, <strong className="text-[#141414]">{supervisorName}</strong>. Your evaluation for{" "}
              <strong className="text-[#141414]">{studentName}</strong> has been received and recorded for the department coordinator.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E8E7E1] text-[11.5px] text-[#7A7973]">
            <p>
              Your review and signature are now attached to the student&apos;s internship logbook record. You may close this window.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
