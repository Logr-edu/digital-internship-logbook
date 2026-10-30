import type { ApiResult } from "@/types/api";
import { api } from "./client";

/* ── Admin Types ──────────────────────────────────────────────────── */

export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: "student" | "coordinator" | "admin";
  is_active: boolean;
  date_joined: string;
  student_profile?: {
    matric_no: string;
    programme: string;
  level?: number | null;
    department_name: string;
    cohort_id?: number;
    weeks_submitted?: number;
    total_weeks?: number;
    running_score_avg?: number;
  };
  coordinator_profile?: {
    staff_id?: string;
    department_name: string;
    programme: string;
  level?: number | null;
    enrolled_students_count?: number;
  };
}

export interface AdminOverview {
  total_users?: number;
  total_students?: number;
  total_coordinators?: number;
  pending_invitations?: number;
  active_cohorts?: number;
  weeks_submitted_today?: number;
  weeks_submitted_this_week?: number;
  students?: number;
  coordinators?: number;
  active_accounts?: number;
  upcoming_cohorts?: number;
  weeks_waiting_for_review?: number;
  supervisor_reviews_waiting?: number;
}

export interface FacultyBreakdownDepartment {
  id: number;
  name: string;
  studentsCount: number;
  coordinatorsCount: number;
}

export interface FacultyBreakdownItem {
  id: number;
  name: string;
  code: string;
  studentsCount: number;
  coordinatorsCount: number;
  departmentsCount: number;
  departments: FacultyBreakdownDepartment[];
}

export interface AdminStats {
  totalStudents: number;
  activeCoordinators: number;
  pendingInvitations: number;
  weeksSubmittedThisWeek: number;
  cohortCompletionRate: number;
  overdueWeeksCount: number;
  pendingStudents?: number;
  departments?: number;
  facultyBreakdown?: FacultyBreakdownItem[];
}

export interface AdminCohortDepartment {
  id: number;
  name: string;
  coordinator: {
    id: number;
    email: string;
    name: string;
  } | null;
}

export interface AdminCohortItem {
  id: number;
  name: string;
  academicYear: string;
  session?: string;
  programme: string;
  level?: number | null;
  faculty?: {
    id: number;
    name: string;
    code: string;
  } | null;
  departments: AdminCohortDepartment[];
  departmentsCount: number;
  studentsCount: number;
  startDate: string;
  endDate: string;
  start_date?: string;
  end_date?: string;
  total_weeks?: number;
  status: string;
  coordinator?: {
    id: number;
    name: string;
    email: string;
  };
}

export interface CreateCohortPayload {
  name?: string;
  faculty_id?: number;
  department_ids?: number[];
  session: string;
  programme: "SWEP" | "SIWES";
  level?: number | null;
  start_date: string;
  end_date: string;
  total_weeks?: number;
  working_days?: number[];
  deadline_weekday?: number;
  deadline_time?: string;
  min_filled_chars?: number;
  request_window_days?: number;
  // Legacy single-department fields (optional)
  department_id?: number;
  coordinator_id?: number;
}

export interface PendingStudentItem {
  id: number;
  name: string;
  email: string;
  matric_no: string;
  department: string;
  degree_programme?: string | null;
  programme: string;
  level?: number | null;
}

export interface AdminCoordinatorItem {
  id: number;
  profileId?: number;
  name: string;
  email: string;
  department: string;
  programme: string;
  level?: number | null;
  staffId?: string;
  assignedStudents: number;
  enrolledStudentsCount?: number;
  status: "ACTIVE" | "PENDING" | "INACTIVE";
  joinedDate: string;
  joinedAt?: string;
}

export interface AdminStudentItem {
  id: number;
  name: string;
  matricNo: string;
  email: string;
  departmentId?: number;
  department: string;
  facultyId?: number;
  facultyName?: string;
  facultyCode?: string;
  programme: string;
  level?: number | null;
  coordinatorName?: string;
  status: "ACTIVE" | "DEACTIVATED" | "GRADUATED";
  weeksSubmitted: number;
  totalWeeks: number;
  runningScoreAvg: number;
  joinedDate: string;
}

export interface DepartmentReportItem {
  id: number;
  department: string;
  programme: string;
  level?: number | null;
  enrolledStudents: number;
  submissionRate: number;
  missedWeeks: number;
  missedWeeksCount?: number;
  approvedExtensions: number;
  averageScore: number;
  averageAttendance?: number;
}

export interface AdminAuditEntry {
  id: number;
  timestamp: string;
  action: string;
  actor: string;
  actor_email?: string;
  role: string;
  target: string;
  target_type?: string;
  target_id?: number;
  ipAddress: string;
  status: string;
  details?: Record<string, unknown>;
}

export interface AdminReport {
  generated_at?: string;
  total_students?: number;
  total_coordinators?: number;
  cohorts?: AdminCohortItem[];
  students?: number;
  active_students?: number;
  attendance_present?: number;
  weeks_submitted?: number;
  weeks_reviewed?: number;
}

/* ── Admin API Client ─────────────────────────────────────────────── */
export const adminApi = {
  async getOverviewStats(): Promise<ApiResult<AdminStats>> {
    const res = await api.get<any>("/admin/overview/");
    if (!res.ok) return res;
    const d = res.data || {};
    const stats: AdminStats = {
      totalStudents: d.students ?? d.total_students ?? 0,
      activeCoordinators: d.coordinators ?? d.total_coordinators ?? 0,
      pendingInvitations: d.supervisor_reviews_waiting ?? d.pending_invitations ?? 0,
      weeksSubmittedThisWeek: d.weeks_submitted_this_week ?? 0,
      cohortCompletionRate: d.cohort_completion_rate ?? d.submission_rate ?? 0,
      overdueWeeksCount: d.overdue_weeks ?? d.overdue_weeks_count ?? 0,
      pendingStudents: d.pending_students ?? 0,
      departments: d.departments ?? d.active_departments ?? 0,
      facultyBreakdown: d.faculty_breakdown ? d.faculty_breakdown.map((f: any) => ({
        id: f.id,
        name: f.name,
        code: f.code,
        studentsCount: f.students_count ?? 0,
        coordinatorsCount: f.coordinators_count ?? 0,
        departmentsCount: f.departments_count ?? (f.departments ? f.departments.length : 0),
        departments: (f.departments || []).map((dep: any) => ({
          id: dep.id,
          name: dep.name,
          studentsCount: dep.students_count ?? 0,
          coordinatorsCount: dep.coordinators_count ?? 0,
        })),
      })) : [],
    };
    return { ok: true, data: stats };
  },

  getOverview(): Promise<ApiResult<AdminOverview>> {
    return api.get("/admin/overview/");
  },

  async getAuditLog(params?: {
    page?: number;
    pageSize?: number;
    actorRole?: string;
  }): Promise<ApiResult<{ results: AdminAuditEntry[]; totalPages: number; total: number; count: number }>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    const res = await api.get<any>(`/admin/audit-logs/${query}`);
    if (!res.ok) return res;

    const rawList = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    const pageSize = params?.pageSize ?? 10;
    const mapped: AdminAuditEntry[] = rawList.map((item: any) => ({
      id: item.id,
      timestamp: item.created_at || new Date().toISOString(),
      action: item.action || "SYSTEM_EVENT",
      actor: item.actor || "—",
      actor_email: item.actor,
      role: item.actor?.includes("student") ? "STUDENT" : item.actor?.includes("coord") ? "COORDINATOR" : "ADMIN",
      target: item.target_type ? `${item.target_type} #${item.target_id}` : "System",
      target_type: item.target_type,
      target_id: item.target_id,
      ipAddress: item.ip_address || "—",
      status: "Recorded",
      details: item.details || {},
    }));

    return {
      ok: true,
      data: {
        results: mapped,
        totalPages: Math.max(1, Math.ceil(mapped.length / pageSize)),
        total: mapped.length,
        count: mapped.length,
      },
    };
  },

  async getCohorts(): Promise<ApiResult<AdminCohortItem[]>> {
    const res = await api.get<any>("/admin/cohorts/");
    if (!res.ok) return res;
    const rawList = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    const mapped: AdminCohortItem[] = rawList.map((c: any) => {
      const depts: AdminCohortDepartment[] = Array.isArray(c.departments) ? c.departments : [];
      return {
        id: c.id,
        name: c.name || `${c.faculty?.code || c.programme} — ${c.session}`,
        academicYear: c.session || "",
        session: c.session,
        programme: c.programme || "SWEP",
        level: c.level,
        faculty: c.faculty || null,
        departments: depts,
        departmentsCount: depts.length || (c.department ? 1 : 0),
        studentsCount: c.enrolled_students ?? c.students_count ?? c.studentsCount ?? 0,
        startDate: c.start_date || "",
        endDate: c.end_date || "",
        start_date: c.start_date,
        end_date: c.end_date,
        total_weeks: c.total_weeks ?? undefined,
        status: c.status || "UPCOMING",
        coordinator: c.coordinator,
      };
    });
    return { ok: true, data: mapped };
  },

  createCohort(payload: CreateCohortPayload): Promise<ApiResult<AdminCohortItem>> {
    return api.post("/admin/cohorts/", payload);
  },

  assignCohortDepartmentCoordinator(
    cohortId: number,
    departmentId: number,
    coordinatorId: number | null
  ): Promise<ApiResult<any>> {
    return api.patch(`/admin/cohorts/${cohortId}/departments/${departmentId}/coordinator/`, {
      coordinator_id: coordinatorId,
    });
  },

  getPendingStudents(): Promise<ApiResult<{ count: number; results: PendingStudentItem[] }>> {
    return api.get("/admin/pending-students/");
  },

  async getCoordinators(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<ApiResult<{ results: AdminCoordinatorItem[]; totalPages: number; total: number }>> {
    const res = await this.getUsers({ role: "coordinator", page: params?.page });
    if (!res.ok) return res as any;
    const users = res.data.results || [];
    const pageSize = params?.pageSize ?? 5;
    const mapped: AdminCoordinatorItem[] = users.map((u: any) => {
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      const profile = u.coordinator_profile || {};
      return {
        id: u.id,
        profileId: profile.id,
        name: fullName || u.name || (u.email ? u.email.split("@")[0] : "Coordinator"),
        email: u.email || "",
        department: profile.department_name || u.department || "—",
        programme: profile.programme || u.programme || "—",
        level: profile.level ?? u.level,
        staffId: profile.staff_id || u.staff_id || "—",
        assignedStudents: profile.enrolled_students_count ?? u.enrolled_students_count ?? 0,
        enrolledStudentsCount: profile.enrolled_students_count ?? u.enrolled_students_count ?? 0,
        status: (u.status === "INACTIVE" || u.is_active === false) ? "INACTIVE" : "ACTIVE",
        joinedDate: u.date_joined || new Date().toISOString().slice(0, 10),
        joinedAt: u.date_joined || new Date().toISOString().slice(0, 10),
      };
    });
    return {
      ok: true,
      data: {
        results: mapped,
        totalPages: Math.max(1, Math.ceil(mapped.length / pageSize)),
        total: res.data.count || mapped.length,
      },
    };
  },

  async getStudents(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    facultyId?: number | string;
    departmentId?: number | string;
  }): Promise<ApiResult<{ results: AdminStudentItem[]; totalPages: number; total: number }>> {
    const extra: Record<string, string> = {};
    if (params?.facultyId && params.facultyId !== "ALL") extra.faculty_id = String(params.facultyId);
    if (params?.departmentId && params.departmentId !== "ALL") extra.department_id = String(params.departmentId);
    if (params?.status && params.status !== "ALL") extra.status = params.status;
    const res = await this.getUsers({
      role: "student",
      search: params?.search,
      page: params?.page,
      ...extra,
    });
    if (!res.ok) return res as any;
    const users = res.data.results || [];
    const pageSize = params?.pageSize ?? 10;
    const mapped: AdminStudentItem[] = users.map((u: any) => {
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      const profile = u.student_profile || {};
      return {
        id: u.id,
        name: fullName || u.name || (u.email ? u.email.split("@")[0] : "Student"),
        matricNo: profile.matric_no || u.matric_no || u.matricNo || "—",
        email: u.email || "",
        departmentId: profile.department_id || u.department_id,
        department: profile.department_name || u.department || "—",
        facultyId: profile.faculty_id || u.faculty_id,
        facultyName: profile.faculty_name || u.faculty_name,
        facultyCode: profile.faculty_code || u.faculty_code,
        programme: profile.programme || u.programme || "—",
        coordinatorName: u.coordinator_name || profile.coordinator_name || "—",
        status: (u.status === "DEACTIVATED" || u.is_active === false) ? "DEACTIVATED" : "ACTIVE",
        weeksSubmitted: profile.weeks_submitted ?? u.weeks_submitted ?? 0,
        totalWeeks: profile.total_weeks ?? u.total_weeks ?? 0,
        runningScoreAvg: profile.running_score_avg ?? u.running_score_avg ?? 0,
        joinedDate: u.date_joined || new Date().toISOString().slice(0, 10),
      };
    });
    return {
      ok: true,
      data: {
        results: mapped,
        totalPages: Math.max(1, Math.ceil(mapped.length / pageSize)),
        total: res.data.count || mapped.length,
      },
    };
  },

  async updateStudent(
    studentId: number,
    payload: { status?: string; reason?: string }
  ): Promise<ApiResult<{ id: number; status: string }>> {
    const isActive = payload.status !== "DEACTIVATED";
    return this.setUserStatus(studentId, isActive) as any;
  },

  async getReports(): Promise<ApiResult<DepartmentReportItem[]>> {
    const res = await api.get<any>("/admin/reports/");
    if (!res.ok) return res;
    // Backend may return a list or a paginated object
    const rawList: any[] = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.results)
      ? res.data.results
      : [];
    const reportList: DepartmentReportItem[] = rawList.map((r: any, idx: number) => ({
      id: r.id ?? idx + 1,
      department: r.department ?? r.department_name ?? "—",
      programme: r.programme ?? "SWEP",
      enrolledStudents: r.enrolled_students ?? r.enrolledStudents ?? 0,
      submissionRate: r.submission_rate ?? r.submissionRate ?? 0,
      missedWeeks: r.missed_weeks ?? r.missedWeeks ?? 0,
      missedWeeksCount: r.missed_weeks ?? r.missedWeeksCount ?? 0,
      approvedExtensions: r.approved_extensions ?? r.approvedExtensions ?? 0,
      averageScore: r.average_score ?? r.averageScore ?? 0,
      averageAttendance: r.average_attendance ?? r.averageAttendance ?? undefined,
    }));
    return { ok: true, data: reportList };
  },

  getUsers(params?: {
    role?: string;
    search?: string;
    page?: number;
    status?: string;
    faculty_id?: string | number;
    department_id?: string | number;
  }): Promise<ApiResult<{ results: AdminUser[]; count: number }>> {
    const qs = new URLSearchParams();
    if (params?.role) qs.set("role", params.role);
    if (params?.search) qs.set("search", params.search);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.status) qs.set("status", params.status);
    if (params?.faculty_id) qs.set("faculty_id", String(params.faculty_id));
    if (params?.department_id) qs.set("department_id", String(params.department_id));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return api.get(`/admin/users/${query}`);
  },

  setUserStatus(
    userId: number,
    isActive: boolean
  ): Promise<ApiResult<{ id: number; is_active: boolean }>> {
    return api.post(`/admin/users/${userId}/status/`, { is_active: isActive });
  },

  deleteUser(userId: number): Promise<ApiResult<{ message: string }>> {
    return api.delete(`/admin/users/${userId}/`);
  },

  assignStudentCoordinator(
    studentId: number,
    coordinatorId: number
  ): Promise<ApiResult<{ message: string }>> {
    return api.post(`/admin/students/${studentId}/assignment/`, {
      coordinator_id: coordinatorId,
    });
  },

  voidSupervisorReview(reviewId: number): Promise<ApiResult<{ id: number; status: string }>> {
    return api.post(`/admin/supervisor-reviews/${reviewId}/void/`, {});
  },
};
