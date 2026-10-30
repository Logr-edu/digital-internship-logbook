export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  status: number;
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
}

export type ApiResult<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResponse<T> {
  results: T[];
  count: number;
  next: string | null;
  previous: string | null;
}

export type NotificationTrigger =
  | "week_unsubmitted_friday"
  | "week_unsubmitted_saturday"
  | "week_locked"
  | "week_submitted_coordinator"
  | "extension_requested"
  | "extension_approved"
  | "extension_denied"
  | "week_returned"
  | "week_reviewed"
  | "supervisor_details_received"
  | "supervisor_review_submitted"
  | "password_reset";

export interface Notification {
  id: string;
  trigger: NotificationTrigger;
  message: string;
  isRead: boolean;
  createdAt: string;
  linkTo: string | null;
}
