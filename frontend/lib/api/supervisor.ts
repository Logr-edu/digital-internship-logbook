import type { ApiResult } from "@/types/api";
import { api } from "./client";

export interface SupervisorDayEntry {
  date: string;
  dayName?: string;
  activities: string;
  skills?: string;
  studentReview?: string;
  reflection?: string;
  photos?: string[];
}

export interface SupervisorWeek {
  weekNumber: number;
  dates?: string;
  entries?: SupervisorDayEntry[];
  days?: SupervisorDayEntry[];
}

export interface SupervisorBatchData {
  student?: {
    name: string;
    matricNo: string;
    programme: string;
    organisation?: string | null;
    department?: string;
  };
  studentName?: string;
  matricNo?: string;
  programme?: string;
  department?: string;
  companyName?: string;
  isCompleted?: boolean;
  completedAt?: string;
  weeks: SupervisorWeek[];
}

export type SupervisorReviewBatchData = SupervisorBatchData;

export interface SupervisorSubmitPayload {
  review_text?: string;
  reviewText?: string;
  signature_type?: "TYPED" | "DRAWN" | "typed" | "drawn";
  signatureType?: "TYPED" | "DRAWN" | "typed" | "drawn";
  signed_name?: string;
  signatureValue?: string;
  supervisorName?: string;
  supervisorRole?: string;
  rating?: number;
  signature_data?: string;
  token?: string;
  confirmationAgreed?: boolean;
  confirm_signature?: boolean;
}

/* ── Supervisor API Client ────────────────────────────────────────── */
export const supervisorApi = {
  /**
   * Validate token and fetch logbook batch.
   * Token is passed as X-Supervisor-Token header (not in URL query).
   */
  async getReviewBatch(token: string): Promise<ApiResult<SupervisorBatchData>> {
    const res = await api.get<any>("/supervisor/review/", {
      public: true,
      headers: { "X-Supervisor-Token": token },
    });
    if (!res.ok) return res;
    const d = res.data;
    const student = d.student || {};
    const norm: SupervisorBatchData = {
      ...d,
      student,
      studentName: d.studentName || student.name || "",
      matricNo: d.matricNo || student.matricNo || "",
      programme: d.programme || student.programme || "SIWES",
      department: d.department || student.department || "",
      companyName: d.companyName || student.organisation || "",
      isCompleted: Boolean(d.isCompleted || d.is_completed),
      completedAt: d.completedAt || d.completed_at,
      weeks: d.weeks || [],
    };
    return { ok: true, data: norm };
  },

  /**
   * Submit supervisor evaluation and signature.
   * Accepts either (token, payload) or a single payload object containing token.
   */
  submitReview(
    arg1: string | SupervisorSubmitPayload,
    arg2?: SupervisorSubmitPayload
  ): Promise<ApiResult<{ message: string }>> {
    const token = typeof arg1 === "string" ? arg1 : (arg1.token ?? "");
    const payload = typeof arg1 === "string" ? (arg2 ?? {}) : arg1;

    const review_text = payload.review_text ?? payload.reviewText ?? "";
    const rawSigType = payload.signature_type ?? payload.signatureType ?? "TYPED";
    const signature_type = rawSigType.toUpperCase() as "TYPED" | "DRAWN";
    const signed_name = payload.signed_name ?? payload.signatureValue ?? payload.supervisorName ?? "";

    const body: Record<string, unknown> = {
      review_text,
      signature_type,
      signed_name,
      confirm_signature: payload.confirm_signature ?? payload.confirmationAgreed ?? false,
    };
    if (payload.signature_data) {
      body.signature_data = payload.signature_data;
    }

    return api.post("/supervisor/review/", body, {
      public: true,
      headers: { "X-Supervisor-Token": token },
    });
  },
};
