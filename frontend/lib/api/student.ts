import type { ApiResult } from "@/types/api";
import { api } from "./client";

export type DayStatus = "ready" | "draft" | "empty" | "submitted" | "reviewed" | "returned" | "future" | "holiday";
export type WeekStatus = "in_progress" | "submitted" | "reviewed" | "returned" | "overdue" | "missed";
export type ProgrammeType = "SWEP" | "SIWES";

export interface StudentDayData {
  id?: number | null;
  date: string;
  dayName: string;
  dayShort: string;
  status: DayStatus;
  activities: string;
  skills: string;
  reflection: string;
  photos: string[];
  rating?: number;
  coordinatorComment?: string;
  isFilled?: boolean;
  isWorkingDay?: boolean;
  isHoliday?: boolean;
  editable?: boolean;
}

export interface StudentWeekSummary {
  id?: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
  status: WeekStatus;
  filledDays: number;
  totalDays: number;
  score?: number;
  feedback?: string;
  days: StudentDayData[];
  canSubmit?: boolean;
  deadline?: {
    datetime: string;
    timeRemaining: string;
    isPast: boolean;
  };
}

export interface CohortData {
  id: number;
  name?: string;
  department: string;
  department_name?: string;
  coordinator?: string;
  coordinator_name?: string | null;
  coordinator_email?: string | null;
  has_coordinator?: boolean;
  has_started?: boolean;
  days_until_start?: number;
  faculty?: {
    id: number;
    name: string;
    code: string;
  } | null;
  programme: ProgrammeType;
  session: string;
  start_date: string;
  end_date: string;
  working_days: number[];
  deadline_weekday: number;
  deadline_time: string;
  status: "UPCOMING" | "ACTIVE" | "CLOSED";
  total_weeks: number;
  max_grace_days?: number;
  holiday_dates?: string[];
}

export interface CurrentCohortResponse {
  server_time: string;
  cohort: CohortData | null;
  week_number?: number;
  day_number?: number;
}

export interface BackendDayEntry {
  id: number | null;
  date: string;
  status: string;
  activities: string;
  skillsLearned: string | null;
  myReview: string | null;
  photos: string[];
  coordinatorComment: string | null;
  rating: number | null;
  isFilled: boolean;
  isWorkingDay: boolean;
  isHoliday: boolean;
  lastSavedAt: string | null;
  editable?: boolean;
}

export interface BackendWeekPayload {
  id: number;
  weekNumber: number;
  totalWeeks: number;
  startDate: string;
  endDate: string;
  status: string;
  days: BackendDayEntry[];
  filledDayCount: number;
  totalWorkingDayCount: number;
  deadline: {
    datetime: string;
    timeRemaining: string;
    isPast: boolean;
  };
  submittedAt: string | null;
  reviewedAt: string | null;
  returnedAt: string | null;
  correctionDeadline: string | null;
  extension: any;
  isLateApproved: boolean;
  canSubmit: boolean;
  missingDays: string[];
}

export interface BackendLogbookHomeResponse {
  server_time: string;
  currentWeek: BackendWeekPayload | null;
  weekNumber: number | null;
  totalWeeks: number;
  dayNumber: number;
  totalDays: number;
  runningScoreAvg?: number | null;
  previousWeeks: Array<{
    id: number;
    weekNumber: number;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  supervisorBatches: any[];
}

export interface StudentDashboardData {
  student: {
    name: string;
    matricNo: string;
    department: string;
    faculty?: string;
    programme: ProgrammeType;
    institution: string;
    email: string;
  };
  cohort: CohortData | null;
  isMatched: boolean;
  metrics: {
    currentWeek: number;
    totalWeeks: number;
    completionPct: number;
    attendanceRate: number;
    daysLogged: number;
    totalTargetDays: number;
    runningScoreAvg: number;
    statusText: string;
  };
  currentWeek: StudentWeekSummary | null;
  weeks: StudentWeekSummary[];
  attendanceSessionActive?: boolean;
  checkedInToday?: boolean;
  recentFeedback?: Array<{
    week: string;
    date: string;
    coordinator: string;
    text: string;
    rating: number | null;
  }>;
}

export interface StudentAttendanceData {
  rate: number;
  attended: number;
  total: number;
  activeSession: boolean;
  checkedInToday?: boolean;
  activeSessionExpiresAt?: string;
  history: Array<{
    date: string;
    dayName: string;
    status: "present" | "absent" | "excused";
    code?: string;
    time?: string;
    note?: string;
  }>;
}

export interface SupervisorReviewBatchItem {
  id: string;
  batchLabel: string;
  recipientEmail: string;
  recipientName: string;
  companyName: string;
  sentAt: string;
  status: "pending" | "reviewed" | "expired";
  reviewedAt?: string;
  rating?: number;
  feedback?: string;
  signedBy?: string;
}

export interface SaveDayPayload {
  activities: string;
  skills: string;
  reflection: string;
  photos?: string[];
  isDraft?: boolean;
}

export interface RequestExtensionPayload {
  reason: "medical" | "technical" | "university_event" | "workplace_emergency" | "other" | string;
  graceDays?: number;
  notes?: string;
}

export interface SendSupervisorBatchPayload {
  supervisorEmail: string;
  supervisorName: string;
  companyName: string;
  phone?: string;
  weekNumbers?: number[];
  personalMessage?: string;
}

/* ── Helper utilities for date & status mapping ─────────────────────── */

function parseDayOfWeek(dateStr: string): { dayName: string; dayShort: string } {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayShorts = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const idx = d.getDay();
    return { dayName: dayNames[idx], dayShort: dayShorts[idx] };
  } catch {
    return { dayName: "Day", dayShort: "Day" };
  }
}

function normalizeDayStatus(entry: BackendDayEntry): DayStatus {
  if (entry.isHoliday) return "holiday";
  const st = (entry.status || "").toLowerCase();
  if (st === "future") return "future";
  if (st === "not_filled") return "empty";
  if (st === "submitted") return "submitted";
  if (st === "reviewed") return "reviewed";
  if (st === "returned") return "returned";
  if (st === "draft") {
    return entry.isFilled ? "ready" : "draft";
  }
  return entry.isFilled ? "ready" : "empty";
}

function normalizeWeekStatus(st: string): WeekStatus {
  const s = (st || "").toLowerCase();
  if (s === "submitted") return "submitted";
  if (s === "reviewed") return "reviewed";
  if (s === "returned") return "returned";
  if (s === "overdue") return "overdue";
  if (s === "missed") return "missed";
  return "in_progress";
}

function transformBackendDay(entry: BackendDayEntry): StudentDayData {
  const { dayName, dayShort } = parseDayOfWeek(entry.date);
  return {
    id: entry.id,
    date: entry.date,
    dayName,
    dayShort,
    status: normalizeDayStatus(entry),
    activities: entry.activities || "",
    skills: entry.skillsLearned || "",
    reflection: entry.myReview || "",
    photos: entry.photos || [],
    rating: entry.rating ?? undefined,
    coordinatorComment: entry.coordinatorComment ?? undefined,
    isFilled: entry.isFilled,
    isWorkingDay: entry.isWorkingDay,
    isHoliday: entry.isHoliday,
    editable: entry.editable,
  };
}

function transformBackendWeek(week: BackendWeekPayload): StudentWeekSummary {
  const days = (week.days || []).map(transformBackendDay);
  return {
    id: week.id,
    weekNumber: week.weekNumber,
    startDate: week.startDate,
    endDate: week.endDate,
    status: normalizeWeekStatus(week.status),
    filledDays: week.filledDayCount || 0,
    totalDays: week.totalWorkingDayCount ?? days.length,
    days,
    canSubmit: week.canSubmit,
    deadline: week.deadline,
  };
}

/* ── Student API Service ────────────────────────────────────────────── */
export const studentApi = {
  /** Fetch the current session cohort matched to the student */
  async getCurrentCohort(): Promise<ApiResult<CurrentCohortResponse>> {
    return api.get<CurrentCohortResponse>("/cohorts/current/");
  },

  /** Fetch student logbook overview / status */
  async getLogbookHome(): Promise<ApiResult<BackendLogbookHomeResponse>> {
    return api.get<BackendLogbookHomeResponse>("/student/logbook/");
  },

  /** Fetch overview dashboard statistics, cohort matching info, and logbook state */
  async getDashboard(): Promise<ApiResult<StudentDashboardData>> {
    try {
      // 1. Fetch Student Profile
      const profileRes = await api.get<{
        message: string;
        profile: {
          account: { email: string; first_name: string; last_name: string; role: string };
          matric_no: string;
          department: string | { name: string };
          faculty?: string;
          programme: ProgrammeType;
          email_verified: boolean;
        };
      }>("/me/student-profile/");

      if (!profileRes.ok) {
        return profileRes;
      }
      if (!profileRes.data?.profile) {
        return {
          ok: false,
          status: 404,
          message: "Failed to load student profile.",
        };
      }

      const profile = profileRes.data.profile;
      const deptName =
        typeof profile.department === "string"
          ? profile.department
          : (profile.department as any)?.name || "—";

      const studentName = `${profile.account.first_name || ""} ${profile.account.last_name || ""}`.trim() || profile.account.email.split("@")[0];
      const matricNo = profile.matric_no || "—";
      const programme = (profile.programme as ProgrammeType) || "SWEP";
      const email = profile.account.email || "";

      // 2. Fetch Current Cohort
      const cohortRes = await api.get<CurrentCohortResponse>("/cohorts/current/");
      const cohort = cohortRes.ok && cohortRes.data?.cohort ? cohortRes.data.cohort : null;
      const isMatched = cohort !== null;

      // 3. If matched, fetch Logbook Home
      let logbookData: BackendLogbookHomeResponse | null = null;
      if (isMatched) {
        const logbookRes = await api.get<BackendLogbookHomeResponse>("/student/logbook/");
        if (logbookRes.ok && logbookRes.data) {
          logbookData = logbookRes.data;
        }
      }

      // 4. If SWEP, check attendance history
      let attendanceRate = 100;
      let checkedInToday = false;
      if (isMatched && programme === "SWEP") {
        try {
          const attRes = await api.get<{
            presentCount: number;
            totalCodedDays: number;
            records: any[];
            checked_in_today: boolean;
          }>("/student/attendance/history/");
          if (attRes.ok) checkedInToday = attRes.data.checked_in_today;
          if (attRes.ok && attRes.data.totalCodedDays > 0) {
            attendanceRate = Math.round((attRes.data.presentCount / attRes.data.totalCodedDays) * 100);
          }
        } catch {
          // Keep default
        }
      }

      // Build weeks & currentWeek
      let currentWeek: StudentWeekSummary | null = null;
      const weeks: StudentWeekSummary[] = [];

      if (logbookData?.currentWeek) {
        currentWeek = transformBackendWeek(logbookData.currentWeek);
      }

      if (logbookData?.previousWeeks) {
        for (const pw of logbookData.previousWeeks) {
          weeks.push({
            id: pw.id,
            weekNumber: pw.weekNumber,
            startDate: pw.startDate,
            endDate: pw.endDate,
            status: normalizeWeekStatus(pw.status),
            filledDays: 5,
            totalDays: 5,
            days: [],
          });
        }
      }

      const totalWeeks = cohort?.total_weeks || logbookData?.totalWeeks || 12;
      const curWeekNo = cohortRes.ok && cohortRes.data?.week_number ? cohortRes.data.week_number : (logbookData?.weekNumber || 1);
      const daysLogged = currentWeek?.filledDays || 0;
      const totalTargetDays = totalWeeks * 5;
      const completionPct = totalWeeks > 0 ? Math.round((Math.max(1, curWeekNo - 1) / totalWeeks) * 100) : 0;

      // Extract feedback from current and previous days if available
      const feedbackItems: Array<{
        week: string;
        date: string;
        coordinator: string;
        text: string;
        rating: number | null;
      }> = [];

      if (currentWeek?.days) {
        for (const day of currentWeek.days) {
          if (day.coordinatorComment) {
            feedbackItems.push({
              week: `Week ${currentWeek.weekNumber}`,
              date: day.date,
              coordinator: cohort?.coordinator || "Coordinator",
              text: day.coordinatorComment,
              rating: day.rating || null,
            });
          }
        }
      }

      return {
        ok: true,
        data: {
          student: {
            name: studentName,
            matricNo,
            department: deptName,
            programme,
            institution: "Obafemi Awolowo University",
            email,
          },
          cohort,
          isMatched,
          metrics: {
            currentWeek: curWeekNo,
            totalWeeks,
            completionPct,
            attendanceRate,
            daysLogged,
            totalTargetDays,
            runningScoreAvg: logbookData?.runningScoreAvg ?? 0,
            statusText: isMatched
              ? `Week ${curWeekNo} of ${totalWeeks} in progress`
              : "Awaiting Department Cohort Launch",
          },
          currentWeek,
          weeks,
          attendanceSessionActive: false,
          checkedInToday,
          recentFeedback: feedbackItems,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 500,
        message: err?.message || "Failed to load dashboard.",
      };
    }
  },

  /** Fetch details for a specific week */
  async getWeek(weekNumber: number): Promise<ApiResult<StudentWeekSummary>> {
    const res = await api.get<BackendWeekPayload>(`/student/logbook/weeks/${weekNumber}/`);
    if (res.ok) {
      return { ok: true, data: transformBackendWeek(res.data) };
    }
    return {
      ok: false,
      status: res.status || 404,
      message: res.message || `Week ${weekNumber} could not be loaded.`,
    };
  },

  /** Submit a completed week for coordinator review */
  async submitWeek(weekNumber: number): Promise<ApiResult<{ message: string }>> {
    const res = await api.post<BackendWeekPayload>(`/student/logbook/weeks/${weekNumber}/`, {});
    if (res.ok) {
      return { ok: true, data: { message: `Week ${weekNumber} submitted for coordinator review.` } };
    }
    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Failed to submit week. Ensure all working days are filled.",
    };
  },

  /** Request a deadline extension appeal for an overdue or pending week */
  async requestWeekExtension(
    weekNumber: number,
    payload: RequestExtensionPayload
  ): Promise<ApiResult<{ message: string; id: string }>> {
    const reasonText = (payload.notes?.trim() || `${payload.reason}: Requesting submission extension`).trim();
    const finalReason = reasonText.length < 10 ? `${reasonText} - Medical/technical reason for extension.` : reasonText;

    const res = await api.post<{ id: number; status: string; requested_at: string }>(
      `/student/logbook/weeks/${weekNumber}/extension-request/`,
      { reason: finalReason }
    );
    if (res.ok) {
      return {
        ok: true,
        data: {
          id: String(res.data.id),
          message: "Extension appeal submitted to coordinator for review.",
        },
      };
    }
    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Unable to submit extension request.",
    };
  },

  /** Fetch log entry for a specific calendar date */
  async getDay(date: string): Promise<ApiResult<StudentDayData>> {
    const res = await api.get<BackendDayEntry & { editable?: boolean }>(`/student/logbook/days/${date}/`);
    if (res.ok) {
      return { ok: true, data: transformBackendDay(res.data) };
    }
    return {
      ok: false,
      status: res.status || 404,
      message: res.message || `Day entry for ${date} was not found.`,
    };
  },

  uploadDayPhoto(date: string, file: File): Promise<ApiResult<{ id: number; url: string }>> {
    const data = new FormData();
    data.append("photo", file);
    return api.post(`/student/logbook/days/${date}/photos/`, data);
  },

  /** Save or update a day entry */
  async saveDay(date: string, payload: SaveDayPayload): Promise<ApiResult<{ message: string; date: string }>> {
    const res = await api.put<{ updatedAt: string; ready: boolean; canSubmit: boolean }>(
      `/student/logbook/days/${date}/`,
      {
        activities: payload.activities || "",
        skills: payload.skills || "",
        review_text: payload.reflection || "",
      }
    );
    if (res.ok) {
      return { ok: true, data: { message: "Day entry saved successfully.", date } };
    }
    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Failed to save daily entry.",
    };
  },

  /** Get attendance records and history for SWEP students */
  async getAttendance(): Promise<ApiResult<StudentAttendanceData>> {
    const res = await api.get<{
      presentCount: number;
      totalCodedDays: number;
      checked_in_today: boolean;
      records: Array<{
        date: string;
        status: "PRESENT" | "ABSENT" | "EXCUSED";
        excusedReason?: string | null;
      }>;
    }>("/student/attendance/history/");

    if (res.ok) {
      const records = res.data.records || [];
      const history = records.map((r) => {
        const { dayName } = parseDayOfWeek(r.date);
        return {
          date: r.date,
          dayName,
          status: (r.status.toLowerCase() as "present" | "absent" | "excused") || "absent",
          note: r.excusedReason || undefined,
        };
      });

      const rate = res.data.totalCodedDays > 0
        ? Math.round((res.data.presentCount / res.data.totalCodedDays) * 100)
        : 100;

      return {
        ok: true,
        data: {
          rate,
          attended: res.data.presentCount,
          total: res.data.totalCodedDays,
          activeSession: false,
          checkedInToday: res.data.checked_in_today,
          history,
        },
      };
    }

    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Failed to fetch attendance records.",
    };
  },

  /** Verify daily attendance OTP code */
  async verifyAttendanceCode(code: string): Promise<ApiResult<{ message: string }>> {
    const cleanCode = code.trim().toUpperCase();
    const res = await api.post<{ date: string; status: string }>(
      "/student/attendance/",
      { code: cleanCode }
    );
    if (res.ok) {
      return { ok: true, data: { message: "Attendance verified successfully." } };
    }
    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Invalid or expired attendance code.",
    };
  },

  /** Fetch workplace supervisor review batches (SIWES) */
  async getSupervisorReviews(): Promise<ApiResult<SupervisorReviewBatchItem[]>> {
    const res = await api.get<{
      unsentWeeks: any[];
      batches: Array<{
        id: number;
        batchNumber: number;
        weekNumbers: number[];
        sentAt: string;
        status: string;
        supervisor: {
          name: string;
          email: string;
          phone: string;
          organisation?: string | null;
        };
        reviewText?: string | null;
        signature?: string | null;
      }>;
    }>("/student/supervisor-reviews/");

    if (res.ok) {
      const batches: SupervisorReviewBatchItem[] = (res.data.batches || []).map((b) => ({
        id: String(b.id),
        batchLabel: `Weeks ${b.weekNumbers.join(", ")} Evaluation`,
        recipientEmail: b.supervisor.email,
        recipientName: b.supervisor.name,
        companyName: b.supervisor.organisation || "Placement Organisation",
        sentAt: b.sentAt,
        status: b.status.toLowerCase() === "reviewed" ? "reviewed"
          : b.status.toLowerCase() === "expired" ? "expired" : "pending",
        feedback: b.reviewText || undefined,
        signedBy: b.signature || undefined,
      }));
      return { ok: true, data: batches };
    }

    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Failed to load supervisor reviews.",
    };
  },

  resendSupervisorReview(reviewId: string): Promise<ApiResult<{ message: string }>> {
    return api.post(`/student/supervisor-reviews/${encodeURIComponent(reviewId)}/resend/`, {});
  },

  /** Send review batch invitation to workplace supervisor */
  async sendSupervisorBatch(payload: SendSupervisorBatchPayload): Promise<ApiResult<{ message: string }>> {
    const phone = payload.phone?.trim() || "+2348000000000" || "+2349000000000";
    const res = await api.post<{ message?: string }>(
      "/student/supervisor-reviews/",
      {
        name: payload.supervisorName.trim(),
        email: payload.supervisorEmail.trim(),
        phone: phone.startsWith("+") ? phone : `+${phone}`,
        organisation: payload.companyName.trim() || undefined,
      }
    );
    if (res.ok) {
      return {
        ok: true,
        data: {
          message: `Evaluation link sent to ${payload.supervisorEmail}. Valid for 72 hours.`,
        },
      };
    }
    return {
      ok: false,
      status: res.status || 400,
      message: res.message || "Failed to send evaluation link to supervisor.",
    };
  },
};
