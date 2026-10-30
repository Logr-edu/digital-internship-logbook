import type { ApiResult } from "@/types/api";
import { api } from "./client";

/* ── Coordinator Types ────────────────────────────────────────────── */
export type ProgrammeType = "SWEP" | "SIWES";

export interface CoordinatorStudentSummary {
  id: number;
  name: string;
  matricNo: string;
  email: string;
  programme: ProgrammeType;
  department?: string;
  status?: string;
  pendingReviewCount?: number;
  runningScoreAvg?: number | null;
  weeksSubmitted: number;
  totalWeeks: number;
  cohortId?: number;
  supervisorName?: string | null;
}

export interface StudentWeekSummary {
  id: number;
  weekNumber: number;
  dates: string;
  status: "reviewed" | "submitted" | "in_progress" | "overdue" | "missed";
  score?: number;
  averageRating?: number | null;
  feedback?: string;
}

export interface CoordinatorStudentDetail extends CoordinatorStudentSummary {
  supervisor?: {
    name: string;
    email: string;
    phone: string;
    organisation?: string | null;
  } | null;
  weeks: StudentWeekSummary[];
}

export interface WeeklySubmissionDay {
  id: number;
  date: string;
  dayName?: string;
  activities: string;
  skills: string;
  studentReview: string;
  reflection?: string;
  rating?: number | null;
  comment?: string;
  photos: string[];
}

export interface WeeklySubmissionDetail {
  id: number;
  weekNumber: number;
  status: string;
  isLate: boolean;
  studentName: string;
  matricNo: string;
  dates?: string;
  submittedAt?: string;
  student: {
    id: number;
    name: string;
    matricNo: string;
  };
  entries: WeeklySubmissionDay[];
  days: WeeklySubmissionDay[];
}

export type WeekEntry = WeeklySubmissionDay;
export type CoordinatorWeekDetail = WeeklySubmissionDetail;

export interface ExtensionRequestItem {
  id: number;
  studentId: number | string;
  student_id?: number | string;
  studentName: string;
  student_name?: string;
  matricNo?: string;
  matric_no?: string;
  weekId: number;
  week_id?: number;
  weekNumber: number;
  week_number?: number;
  reason: string;
  status?: string;
  requestedAt: string;
  requested_at?: string;
  deadlineDate?: string;
  attachmentUrl?: string | null;
  coordinatorComment?: string | null;
}

export interface AttendanceRecordItem {
  studentId: string | number;
  studentName: string;
  matricNo: string;
  status: "present" | "absent" | "excused";
  time?: string;
  reason?: string;
}

export interface AttendanceSession {
  id: number;
  code: string;
  active?: boolean;
  secondsLeft?: number;
  seconds_left?: number;
  presentCount: number;
  present_count?: number;
  totalStudents: number;
  expiresAt?: string;
  expires_at?: string;
  records: AttendanceRecordItem[];
}

export interface CohortHoliday {
  date: string;
  label: string;
}

export interface CohortSettings {
  id?: number;
  programme: ProgrammeType;
  session: string;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  start_date?: string;
  end_date?: string;
  workingDays?: number[];
  working_days?: number[];
  deadlineWeekday?: number;
  deadline_weekday?: number;
  deadlineTime?: string;
  deadline_time?: string;
  totalWeeks?: number;
  total_weeks?: number;
  maxGraceDays?: number;
  max_grace_days?: number;
  status?: string;
  holidays: CohortHoliday[];
  holiday_dates?: string[];
}

/* ── Coordinator API Client ───────────────────────────────────────── */
export const coordinatorApi = {
  getDashboardData(): Promise<ApiResult<{
    stats: {
      enrolledStudents: number;
      pendingReviews: number;
      pendingExtensions: number;
      overdueWeeks: number;
      averageAttendance: number;
    };
    recentSubmissions: Array<{
      id: string;
      studentName: string;
      matricNo: string;
      weekNumber: number;
      dates: string;
      tasksSummary: string;
      status: "PENDING_REVIEW" | "APPROVED" | "RETURNED";
      submittedAt: string;
    }>;
    cohortInfo: {
      programme: ProgrammeType;
      cycle: string;
      weekNumber: number;
      totalWeeks: number;
      submissionDeadline: string;
    };
  }>> {
    return api.get("/coordinator/dashboard/");
  },

  async getStudents(
    query?: string | { query?: string; page?: number },
    filter?: string
  ): Promise<ApiResult<CoordinatorStudentSummary[]>> {
    const q = typeof query === "string" ? query : query?.query;
    const params = new URLSearchParams();
    if (q?.trim()) params.append("q", q.trim());
    if (filter && filter !== "all") params.append("filter", filter);
    const qs = params.toString() ? `?${params.toString()}` : "";
    
    const res = await api.get<{ results: CoordinatorStudentSummary[] } | CoordinatorStudentSummary[]>(`/coordinator/students/${qs}`);
    if (!res.ok) return res as ApiResult<CoordinatorStudentSummary[]>;
    const list = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    return { ok: true, data: list };
  },

  getStudentDetail(id: number | string): Promise<ApiResult<CoordinatorStudentDetail>> {
    return api.get(`/coordinator/students/${id}/`);
  },

  async getWeekDetail(weekId: number | string): Promise<ApiResult<WeeklySubmissionDetail>> {
    const res = await api.get<any>(`/coordinator/weeks/${weekId}/`);
    if (!res.ok) return res;
    const d = res.data;
    const entries = d.entries || d.days || [];
    const norm: WeeklySubmissionDetail = {
      id: d.id,
      weekNumber: d.weekNumber ?? d.week_no ?? 0,
      status: d.status ?? "open",
      isLate: Boolean(d.isLate ?? d.is_late),
      studentName: d.studentName || d.student?.name || "",
      matricNo: d.matricNo || d.student?.matricNo || "",
      student: d.student || { id: 0, name: d.studentName || "", matricNo: d.matricNo || "" },
      entries,
      days: entries,
    };
    return { ok: true, data: norm };
  },

  getSubmissionDetail(weekId: number | string): Promise<ApiResult<WeeklySubmissionDetail>> {
    return this.getWeekDetail(weekId);
  },

  /** Save rating + comment for one logbook entry */
  reviewEntry(
    entryId: number,
    rating: number,
    comment: string
  ): Promise<ApiResult<{ rating: number; comment: string }>> {
    return api.put(`/coordinator/entries/${entryId}/review/`, { rating, comment });
  },

  /** Mark week as fully reviewed — all entries must already be rated */
  finishWeek(weekId: number): Promise<ApiResult<{ message: string; status: string }>> {
    return api.post(`/coordinator/weeks/${weekId}/finish/`, {});
  },

  /** Return week to student with a correction comment */
  returnWeek(
    weekId: number,
    comment: string
  ): Promise<ApiResult<{ message: string; correctionDeadline: string }>> {
    return api.post(`/coordinator/weeks/${weekId}/return/`, { comment });
  },

  async submitReview(
    weekId: number | string,
    decision: "approve" | "return",
    payload: {
      ratings?: Record<number, number>;
      comments?: Record<number, string>;
      overallComment?: string;
      returnReason?: string;
      correctionDeadline?: string;
    }
  ): Promise<ApiResult<{ averageScore: number; message?: string }>> {
    const weekRes = await this.getWeekDetail(Number(weekId));
    let avg = 0;
    if (weekRes.ok && weekRes.data?.entries) {
      const entries = weekRes.data.entries;
      let total = 0;
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const rating = payload.ratings?.[i] ?? entry.rating ?? 3;
        const comment = payload.comments?.[i] ?? entry.comment ?? "";
        await this.reviewEntry(entry.id, rating, comment);
        total += rating;
        count += 1;
      }
      avg = count > 0 ? total / count : 0;
    }

    if (decision === "approve") {
      const finishRes = await this.finishWeek(Number(weekId));
      if (!finishRes.ok) return finishRes as any;
      return { ok: true, data: { averageScore: avg, message: finishRes.data?.message } };
    } else {
      const reason = payload.returnReason || payload.overallComment || "Returned for corrections";
      const returnRes = await this.returnWeek(Number(weekId), reason);
      if (!returnRes.ok) return returnRes as any;
      return { ok: true, data: { averageScore: avg, message: returnRes.data?.message } };
    }
  },

  async getExtensionRequests(): Promise<ApiResult<ExtensionRequestItem[]>> {
    const res = await api.get<{ results: ExtensionRequestItem[] } | ExtensionRequestItem[]>("/coordinator/extension-requests/");
    if (!res.ok) return res as ApiResult<ExtensionRequestItem[]>;
    const items = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    return { ok: true, data: items };
  },

  decideExtension(
    requestId: number | string,
    decision: "APPROVED" | "DENIED" | "approve" | "deny",
    payload: { days?: number; graceDays?: number; comment?: string }
  ): Promise<ApiResult<{ id: number; status: string; approved_until?: string | null }>> {
    const normalizedDecision = decision.toUpperCase() as "APPROVED" | "DENIED";
    return api.post(`/coordinator/extension-requests/${requestId}/decision/`, {
      decision: normalizedDecision,
      days: payload.days ?? payload.graceDays ?? 3,
      comment: payload.comment ?? "",
    });
  },

  async getAttendanceSession(): Promise<ApiResult<AttendanceSession>> {
    const res = await api.get<any>("/coordinator/attendance/sessions/current/");
    if (!res.ok) return res;
    const d = res.data;
    if (!d || d.session === null) {
      return {
        ok: true,
        data: {
          id: 0,
          code: "",
          active: false,
          secondsLeft: 0,
          presentCount: 0,
          totalStudents: 0,
          records: [],
        },
      };
    }
    return {
      ok: true,
      data: {
        id: d.id,
        code: d.code,
        active: (d.seconds_left ?? 0) > 0,
        secondsLeft: d.seconds_left ?? 0,
        seconds_left: d.seconds_left ?? 0,
        presentCount: d.present_count ?? 0,
        present_count: d.present_count ?? 0,
        totalStudents: d.total_students ?? 0,
        expiresAt: d.expires_at,
        records: d.records ?? [],
      },
    };
  },

  generateAttendanceCode(durationMinutes: number): Promise<ApiResult<{
    id: number;
    code: string;
    expires_at: string;
  }>> {
    return api.post("/coordinator/attendance/sessions/", { minutes: durationMinutes });
  },

  endAttendanceSession(sessionId: number): Promise<ApiResult<{ message: string }>> {
    return api.post(`/coordinator/attendance/sessions/${sessionId}/end/`, {});
  },

  overrideAttendance(
    studentId: number | string,
    status: "PRESENT" | "EXCUSED" | "present" | "excused",
    reason: string,
    date?: string
  ): Promise<ApiResult<{ date: string; status: string }>> {
    return api.post(`/coordinator/students/${studentId}/attendance/`, {
      status: status.toUpperCase(),
      reason,
      date: date || new Date().toISOString().slice(0, 10),
    });
  },

  async getCohortSettings(): Promise<ApiResult<CohortSettings>> {
    const res = await api.get<any>("/coordinator/cohorts/");
    if (!res.ok) return res;
    const raw = res.data;
    const item = (raw && "results" in raw && Array.isArray(raw.results)) ? raw.results[0] : (Array.isArray(raw) ? raw[0] : raw);
    if (!item) {
      return {
        ok: true,
        data: {
          programme: "SWEP",
          session: "",
          academicYear: "",
          startDate: "",
          endDate: "",
          workingDays: [0, 1, 2, 3, 4],
          deadlineWeekday: 5,
          deadlineTime: "23:59",
          totalWeeks: 0,
          maxGraceDays: 7,
          status: "NONE",
          holidays: [],
        },
      };
    }
    const norm: CohortSettings = {
      ...item,
      programme: item.programme || "SWEP",
      session: item.session || "",
      academicYear: item.academicYear || item.session || "",
      startDate: item.startDate || item.start_date || "",
      endDate: item.endDate || item.end_date || "",
      workingDays: item.workingDays || item.working_days || [0, 1, 2, 3, 4],
      deadlineWeekday: item.deadlineWeekday ?? item.deadline_weekday ?? 5,
      deadlineTime: item.deadlineTime || item.deadline_time || "23:59",
      totalWeeks: item.totalWeeks ?? item.total_weeks ?? 0,
      maxGraceDays: item.maxGraceDays ?? item.max_grace_days ?? 7,
      holidays: item.holidays || (item.holiday_dates || []).map((d: string) => ({ date: d, label: "Public Holiday" })),
    };
    return { ok: true, data: norm };
  },
};
