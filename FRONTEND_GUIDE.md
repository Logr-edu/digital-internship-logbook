# Frontend Integration Guide

This guide describes the authentication and management APIs as routed in `backend/auth/urls.py` and `backend/management/urls.py`. Every endpoint is under `/api/v1/` and uses JSON request/response bodies unless stated otherwise. Use the full URL as `<API_BASE_URL>/api/v1/...` and include the trailing slash.

## Requests, tokens, and errors

- Send `Content-Type: application/json` for JSON requests.
- Protected endpoints require `Authorization: Bearer <access>`.
- Login and invitation acceptance return `access` and `refresh` tokens in JSON. Keep the refresh token available to the client so it can be sent to refresh and logout. These endpoints do not set a cookie.
- When an access token expires, send the refresh token to `POST /auth/refresh/`. Save both replacement tokens from the response; the old refresh token is blacklisted after rotation.
- Authentication/flow errors generally look like `{ "code": "...", "message": "..." }`. Serializer validation errors use DRF's field format, such as `{ "email": ["Enter a valid email address."] }`. Some existing endpoints use `{ "error": "..." }` or `{ "message": "..." }` instead; see endpoint details below.
- OTPs expire after 10 minutes. Student signup details remain pending for up to 24 hours. Coordinator invitation links expire after 72 hours.

## Student signup and verification

### `POST /auth/student/signup/`

```json
{
  "first_name": "Ada",
  "last_name": "Student",
  "matric_no": "CSC/2023/001",
  "email": "ada@students.example.edu",
  "department_id": 1,
  "programme": "SIWES",
  "password": "a-strong-password"
}
```

`department_id` must be an existing department ID. `programme` is `SWEP` or `SIWES`. The email domain must exactly match one of the configured `STUDENT_EMAIL_DOMAINS`; the frontend should not hardcode this list. On success (`201`):

```json
{ "message": "Verification code sent.", "email": "ada@students.example.edu" }
```

The frontend should then show the OTP form. Signup does not return tokens; the student must verify the email and then sign in.

### `POST /auth/student/verify-otp/`

```json
{ "email": "ada@students.example.edu", "otp": "012345" }
```

Keep `otp` as a string so leading zeroes are preserved. Success (`200`):

```json
{ "message": "Email verified. Your student profile has been created." }
```

Invalid or expired code returns `otp_invalid_or_expired` (`400`). If pending signup data has expired, the response is `signup_expired` (`400`); ask the student to sign up again.

### `POST /auth/student/resend-otp/`

```json
{ "email": "ada@students.example.edu" }
```

Success (`200`) is deliberately generic, even if no pending signup exists:

```json
{ "server_time": "...", "message": "If verification is needed, a code has been sent." }
```

Email delivery failure returns `email_delivery_failed` (`503`).

## Sign in and token lifecycle

### `POST /auth/login/`

Students and coordinators use the same endpoint:

```json
{ "email": "ada@students.example.edu", "password": "a-strong-password" }
```

Success (`200`):

```json
{
  "message": "Login successful",
  "username": "Ada",
  "refresh": "<refresh-token>",
  "access": "<access-token>"
}
```

Store both tokens. Send the access token as a Bearer token on protected requests. Errors include `invalid_credentials` (`401`), `email_not_verified` (`403`), and `account_type_invalid` (`403`).

### `POST /auth/admin/login/`

Uses the same `{ "email", "password" }` request and returns the same token response. Only a Django superuser can use this endpoint; other accounts receive `invalid_credentials` (`401`).

### `POST /auth/refresh/`

No access token is required. Send the current refresh token in JSON:

```json
{ "refresh": "<current-refresh-token>" }
```

Success (`200`):

```json
{
  "server_time": "...",
  "access": "<new-access-token>",
  "refresh": "<new-refresh-token>"
}
```

Replace both stored tokens. Missing, invalid, expired, or already-rotated refresh tokens return `refresh_token_invalid` (`401`). Inactive accounts return `account_deactivated` (`403`).

### `POST /auth/logout/`

Requires a valid access token and the current refresh token in JSON:

```json
{ "refresh": "<current-refresh-token>" }
```

Success (`200`): `{ "message": "Signed out." }`. Clear both tokens client-side after success. Missing refresh token returns `{ "error": "Refresh token is required" }` (`400`); invalid token returns `{ "error": "Invalid or expired token" }` (`400`).

## Coordinator invitation flow

The admin must first create an invitation. The coordinator opens the emailed link, whose token should be read from the `token` query parameter, and the frontend validates it before showing the account form. The invitation email is returned by validation and should be displayed read-only; the accept form does not submit an email or department.

### `POST /admin/invitations/` (admin)

Requires a superuser access token. Request:

```json
{ "email": "coordinator@example.edu", "department_id": 1, "programme": "SIWES" }
```

Success (`201`): `{ "server_time": "...", "id": 4, "status": "PENDING" }`. The API sends the invitation email. Errors include `permission_denied` (`403`) and `email_delivery_failed` (`503`).

### `GET /admin/invitations/` (admin)

Requires a superuser access token. Returns the latest invitations:

```json
{
  "server_time": "...",
  "results": [
    {
      "id": 4,
      "email": "coordinator@example.edu",
      "department": "Computer Science",
      "programme": "SIWES",
      "status": "PENDING",
      "expires_at": "..."
    }
  ]
}
```

Expired pending invitations are presented with status `EXPIRED`.

### `POST /admin/invitations/{id}/resend/` and `DELETE /admin/invitations/{id}/`

Both require a superuser access token. Resend has no request body; it replaces the token and sends a new link. Success: `{ "server_time": "...", "message": "Invitation resent." }`. Delete has no request body and revokes a pending invitation. Success: `{ "server_time": "...", "message": "Invitation revoked." }`.

### `GET /invitations/validate/?token=<invitation-token>`

Public. Success (`200`):

```json
{
  "server_time": "...",
  "email": "coordinator@example.edu",
  "department": "Computer Science",
  "programme": "SIWES",
  "expires_at": "..."
}
```

Invalid, expired, revoked, or already accepted links return `invitation_invalid` (`400`).

### `POST /invitations/accept/`

Public. Submit the token from the link and coordinator-entered fields:

```json
{
  "token": "<invitation-token>",
  "first_name": "Ada",
  "last_name": "Coordinator",
  "phone": "+2348000000000",
  "password": "a-strong-password"
}
```

The server uses the invitation's email, department, and programme. Success (`201`) returns `{ "server_time", "user", "access", "refresh" }`; store the tokens as for login. Invalid/expired links return `invitation_invalid` (`400`); an existing email returns `email_taken` (`409`); delivery is not attempted by this endpoint.

## Profile and password endpoints

### `GET /me/student-profile/` and `GET /me/coordinator-profile/`

Require an access token. Student success returns `profile` with `account`, `matric_no`, `department`, `programme`, and `email_verified`. Coordinator success returns `profile` with `account`, `department`, `programme`, and `phone`. A user without that profile receives `{ "message": "Profile doesn't exist" }` (`404`).

### `POST /me/password/`

Requires an access token. Request: `{ "current_password": "...", "new_password": "..." }`. The new password must pass Django's configured password validators. Success: `{ "message": "Password successfully changed" }`. An incorrect current password returns `current_password_invalid` (`400`).

## Password reset

### `POST /auth/forgot-password/`

Public. Request: `{ "email": "user@example.edu" }`. Success (`200`) always returns `{ "server_time": "...", "message": "If the account exists, reset instructions will be sent." }`. If the address belongs to an active account, the email links to the frontend route configured by `FRONTEND_URL` with `email` and `token` query parameters.

### `POST /auth/reset-password/`

Public. Read `email` and `token` from the reset link, then submit them with the new password:

```json
{ "email": "user@example.edu", "token": "<reset-token>", "password": "a-new-strong-password" }
```

Success (`200`): `{ "message": "Password has been reset." }`. An invalid or expired token returns `reset_token_invalid` (`400`).

There is currently no `/me/` route in the URL list; use the role-specific profile routes above.

## Frontend integration checklist

- Keep OTP input as text, exactly six digits.
- Show signup success as “check your email,” then offer resend with a neutral result message.
- After OTP verification, direct the student to sign in; verification does not automatically authenticate.
- For every protected request, use the access token. If refresh succeeds, replace both tokens before retrying the original request.
- On logout, send the refresh token and clear locally stored tokens.
- For coordinator acceptance, prefill the invitation email from validation as read-only and submit the link token; never ask the coordinator to type the token.
- Handle serializer validation objects separately from flow errors because their response shapes differ.
- Backend currently has no CSRF endpoint or refresh cookie flow; token exchange is JSON-based.

## Cohorts, attendance, logbook review, and admin

All routes below are under `/api/v1/`. Protected routes require `Authorization: Bearer <access-token>`. Management flow errors use `{ "code": "...", "message": "..." }`; serializer validation errors use DRF's field format, for example `{ "reason": ["This field is required."] }`.

Student cohort assignment is automatic: verified students join the matching upcoming or active cohort for their department and programme. When a coordinator creates a cohort, matching students who do not already have a cohort are attached to it.

### Cohorts

| Method and route | Purpose and request | Success |
| --- | --- | --- |
| `POST /coordinator/cohorts/` | Create a cohort. Include `programme`, `session`, `start_date`, `end_date`; optionally set `working_days`, `holidays`, deadlines, and attendance settings. | `201`: cohort fields, calculated `status`, and `total_weeks` |
| `PATCH /coordinator/cohorts/{id}/` | Update a cohort owned by the signed-in coordinator. | Updated cohort |
| `GET /cohorts/current/` | Read the signed-in student's cohort and current position. | `{ "server_time", "cohort", "week_number", "day_number" }`; `cohort` may be `null` |
| `GET /admin/cohorts/` | Admin list of cohorts. | `{ "results": [...] }` |
| `PATCH /admin/cohorts/{id}/` | Admin edit of a cohort. | Updated cohort |

Date errors include `cohort_started` when saved logbook activity prevents moving cohort dates and `holiday_has_entry` when a holiday overlaps a saved entry. A coordinator can create cohorts only for their assigned programme and department.

### SWEP attendance

SWEP attendance applies only to students in the SWEP programme.

| Method and route | Purpose and request | Success |
| --- | --- | --- |
| `POST /coordinator/attendance/sessions/` | Open a code; `{ "minutes": 3 }` (optional, 1–3). | `201`: `{ "id", "code", "expires_at", "server_time" }` |
| `GET /coordinator/attendance/sessions/current/` | Get the current code and present count. | `{ "session": null }` or session details with `code`, `seconds_left`, and `present_count` |
| `POST /coordinator/attendance/sessions/{id}/end/` | End a session; empty body. | `{ "message": "Attendance session ended." }` |
| `POST /student/attendance/` | Check in; `{ "code": "ABC234" }`. | `{ "date", "status": "PRESENT" }` |
| `GET /student/attendance/history/` | Read attendance history. | `{ "presentCount", "totalCodedDays", "records": [...] }` |
| `POST /coordinator/students/{id}/attendance/` | Override; `{ "date": "YYYY-MM-DD", "status": "PRESENT" or "EXCUSED", "reason": "..." }`. | `{ "date", "status" }` |

The code is six characters and expires within three minutes. A student can check in once per day; repeating a successful check-in returns the existing record. A day with an attendance session but no student record appears as `ABSENT` in history. Common errors: `not_applicable`, `attendance_closed`, `code_invalid_or_expired`, `too_many_attempts`, `not_working_day`, and `attendance_limit`.

### Student logbook entries and photos

| Method and route | Purpose and request | Success |
| --- | --- | --- |
| `GET /student/logbook/` | Read current week and progress. | Current week, previous weeks, deadline, and progress fields |
| `GET /student/logbook/weeks/{week_no}/` | Read a specific week. | Week status, working days, entries, and deadline |
| `POST /student/logbook/weeks/{week_no}/` | Submit a week after each working day has enough activity text. | Updated week payload |
| `GET /student/logbook/days/{YYYY-MM-DD}/` | Read one working day. | Entry fields, comments/ratings if present, photo URLs, and `editable` |
| `PUT /student/logbook/days/{YYYY-MM-DD}/` | Save `{ "activities": "...", "skills": "...", "review_text": "..." }`. | `{ "updatedAt", "ready", "canSubmit" }` |

Photos are optional. Save the day first, then send a multipart request with the file field named `photo` to `POST /student/logbook/days/{YYYY-MM-DD}/photos/`. PNG, JPEG, and WebP files up to 5 MB are accepted; each day can have at most five. Success (`201`) returns the photo id and a five-minute signed Cloudinary URL. Remove it with `DELETE /student/logbook/photos/{photo_id}/`. `CLOUDINARY_URL` must be configured on the backend.

Photo errors include `entry_required`, `photo_required`, `photo_type_invalid`, `photo_too_large`, `photo_limit`, and `photo_upload_failed`.

### Coordinator dashboard, extensions, and grading

`GET /coordinator/dashboard/` returns `stats` (`enrolledStudents`, `pendingReviews`, `pendingExtensions`, `overdueWeeks`, and `averageAttendance`), up to five `recentSubmissions`, and `cohortInfo` (`programme`, `cycle`, `weekNumber`, `totalWeeks`, and `submissionDeadline`). When the coordinator has no cohort, the cohort cycle is `No cohort created`, week and total weeks are `0`, and the deadline is `Not set`. The response also retains `student_count`, `submitted_weeks`, `weeks_to_review`, and `attendance_today` count fields. `GET /coordinator/students/` lists assigned students (optional `?q=` search), including `supervisorName` for SIWES students when saved. `GET /coordinator/students/{id}/` returns one student's week progress and, for SIWES, a `supervisor` object with `name`, `email`, `phone`, and `organisation`; it is `null` until the student first sends a supervisor review. `GET /coordinator/weeks/{id}/` reads a submitted week and its entries.

Grade an entry with `PUT /coordinator/entries/{id}/review/` and `{ "rating": 1, "comment": "..." }`; the rating must be 1–5. Finish a week with `POST /coordinator/weeks/{id}/finish/` after every written entry has a rating. Return it for correction with `POST /coordinator/weeks/{id}/return/` and `{ "comment": "..." }`. Coordinators provide the only numeric grades; supervisors do not score logbooks.

After a deadline passes, a student can request more time with `POST /student/logbook/weeks/{week_no}/extension-request/` and `{ "reason": "..." }`, within the cohort's request window. Coordinators review pending requests with `GET /coordinator/extension-requests/`; decide with `POST /coordinator/extension-requests/{id}/decision/` and `{ "decision": "APPROVED", "days": 3 }`, or `{ "decision": "REJECTED", "comment": "..." }`. Approved days cannot exceed the cohort's `max_grace_days`; the revised deadline appears in the week response.

Common errors include `week_locked`, `days_not_filled`, `deadline_passed`, `extension_window_closed`, `entries_not_rated`, and `week_in_supervisor_review`.

### SIWES supervisor review

The student uses `GET /student/supervisor-reviews/` to list batches and eligible unsent weeks. `POST` on that route sends eligible submitted/reviewed weeks and supervisor details: `{ "name": "...", "email": "...", "phone": "+...", "organisation": "..." }`. The student can resend a link with `POST /student/supervisor-reviews/{id}/resend/` (empty body; limited to one resend per 24 hours).

The emailed review link contains a token. The frontend reads it from the link, then sends it in `X-Supervisor-Token` for both `GET /supervisor/review/` and `POST /supervisor/review/`. Supervisors have no account, do not receive a score field, and the token expires after 14 days and is single-use. `POST /supervisor/review/request-link/` asks the student to resend the link; it does not create a token.

For a typed signature, submit `{ "review_text": "...", "signature_type": "TYPED", "signed_name": "Full Name", "confirm_signature": true }`. For a drawn signature, submit `signature_type: "DRAWN"` and `signature_data` containing a PNG data URL; it must be smaller than 100 KB. The backend uploads the image to Cloudinary as an authenticated asset. The student's batch response includes a five-minute signed URL for a drawn signature. If Cloudinary is unavailable, submission returns `signature_upload_failed` (`503`) and the token remains usable.

The signature pad should be a browser canvas. The supervisor can draw with a mouse or trackpad on a laptop, or a finger or stylus on a phone/tablet.

**The frontend should make the pad large enough for touch, prevent the page from scrolling while someone signs on it, and provide Clear and Submit buttons.**

Token errors include `token_invalid`, `token_expired`, `already_submitted`, and `throttled`. Students receive `nothing_to_send` when there are no eligible weeks.

### In-app notifications

Notifications belong to the signed-in account. Use the access token for these endpoints; each user only receives their own notifications. `GET /notifications/` returns notifications newest first and an unread count:

```json
{
  "results": [
    {
      "id": "12",
      "trigger": "extension_approved",
      "message": "Your extension request for week 2 was approved.",
      "isRead": false,
      "createdAt": "2026-10-23T14:00:00+01:00",
      "linkTo": "/student/week/2"
    }
  ],
  "unreadCount": 1
}
```

Call `POST /notifications/{id}/read/` when the user marks one notification as read; the response is that notification with `isRead: true`. Call `POST /notifications/read-all/` to mark all of the signed-in account's unread notifications as read; success returns `{ "updated": 3 }`. Trying to mark another account's notification as read returns `not_found` (`404`).

Trigger values are `week_unsubmitted_friday`, `week_unsubmitted_saturday`, `week_locked`, `week_submitted_coordinator`, `extension_requested`, `extension_approved`, `extension_denied`, `week_returned`, `week_reviewed`, `supervisor_details_received`, and `supervisor_review_submitted`.

In-app notifications are created when a week is submitted, an extension is requested or decided, a coordinator returns or finishes reviewing a week, supervisor details are sent, or a supervisor review is submitted. The scheduled reminder command also creates unsubmitted-week notifications on Friday at 3:00 p.m. and Saturday at 6:00 p.m. Africa/Lagos time, and a week-locked notification after its effective deadline. The command must run every five minutes for those checks. Email delivery remains a separate channel.

### Admin

Every admin route requires a superuser access token.

| Method and route | Purpose and request | Success |
| --- | --- | --- |
| `GET /admin/overview/` | Read counts for students, coordinators, accounts, cohorts, and pending reviews. | Count fields |
| `GET /admin/users/` | List accounts; optional `q`, `role`, and `status` query filters. | `{ "results": [...] }` |
| `PATCH /admin/users/{id}/status/` | Deactivate/withdraw/rusticate: `{ "status", "reason", "note" }`. | Account status; refresh tokens are blacklisted |
| `POST /admin/users/{id}/status/` | Reactivate an account; empty body. | `{ "id", "status": "ACTIVE", "is_active": true }` |
| `DELETE /admin/users/{id}/` | Hard-delete after confirmation: `{ "confirm_email": "account email" }`. | `204`; audit event is recorded first |
| `POST /admin/students/{id}/reassign/` | Assign a coordinator: `{ "coordinator_id": 1 }`. | `{ "student_id", "coordinator_id" }` |
| `POST /admin/coordinators/{id}/reassign/` | Move students/cohorts: `{ "new_coordinator_id": 2 }`; old account is deactivated. | Moved student count and account status |
| `PATCH /admin/students/{id}/assignment/` | Correct cohort/coordinator assignment with `cohort_id` and/or `coordinator_id`. | Updated student assignment |
| `PATCH /admin/students/{id}/programme/` | Change programme: `{ "programme": "SWEP" or "SIWES" }`; only before logbook entries exist. | Updated programme and cohort id |
| `GET /admin/reports/` | Counts; optional `?cohort_id={id}` or `?format=csv`. | JSON summary or CSV download |
| `POST /admin/supervisor-reviews/{id}/void/` | Void an unsubmitted batch and revoke its link. | Batch id and `void` status |
| `GET /admin/audit-logs/` | Latest 200 events; optional `actor`, `action`, `date_from`, `date_to` filters. | `{ "results": [...] }` |

Admin errors include `not_found`, `assignment_mismatch`, `programme_locked`, `already_reviewed`, `cohort_not_found`, `delete_confirmation_required`, and `account_in_use`. Status changes preserve user records; hard deletion is available only through the separately confirmed endpoint above.


## Training levels, invitation email cards, and attendance updates

- Student signup, coordinator invitations, and cohort creation accept `level` as a number. SWEP always uses `200`; SIWES requires `300` or `400`. Omitting a SIWES level returns a field validation error. Read responses include `level` for cohorts, invitations, and profiles.
- Automatic enrolment matches department, programme, and level. Coordinator invitations assign the accepted coordinator only to matching-level cohorts. Manual assignment and coordinator replacement also enforce matching levels.
- Existing SWEP records are migrated to 200L. Existing SIWES levels remain unset because the old records do not distinguish 300L from 400L. Set the correct levels on existing SIWES cohorts, student profiles, coordinator profiles, and pending invitations in Django Admin. Existing assignments are preserved; unclassified SIWES students are not automatically enrolled. After classification, an unassigned verified student is matched at the next login or when a matching cohort is created.
- `GET /student/attendance/history/` now includes `checked_in_today`, calculated using the backend's local date. Present and excused students do not need another code that day. Both the dashboard and attendance page use this flag.
- `GET /coordinator/attendance/sessions/current/` includes `total_students` and a `records` roster with `studentId`, `studentName`, `matricNo`, `status`, and `reason`. Counts and roster cover the coordinator's enrolled students in that cohort. While a session is active the page refreshes every five seconds.
- Emails are multipart plain text plus HTML. The shared card uses Logr orange, charcoal, warm neutral backgrounds, and Plus Jakarta Sans with an Arial fallback. HTML renders action links as named buttons; the plain text alternative retains links for email clients that cannot show HTML.

Apply the new schema migrations before running this version:

```powershell
python manage.py migrate
```


### Automatic coordinator assignment at cohort creation

`POST /admin/cohorts/` now assigns an existing active coordinator in each selected department before enrolling students. SWEP matches department and programme; SIWES additionally matches 300L or 400L. Inactive coordinators are excluded. Exactly one matching active coordinator is assigned automatically. If none match, the department remains unassigned and the admin can invite one. If several match, it remains unassigned until an admin selects a coordinator; students still enrol and are linked to that coordinator when the selection is saved. Existing assignments are preserved. Creating a new cohort does not move students already enrolled in another cohort.

The cohorts page shows Invite when no matching coordinator exists, Choose Coordinator for multiple matches, and Change Coordinator for an assigned department. Manual assignment remains available for older unassigned cohorts that already have a matching coordinator. No database migration is required for this change.


`GET /coordinator/students/?filter=needs_review` returns only assigned students with submitted weeks awaiting coordinator review. Student list rows include `pendingReviewCount` and a `status` badge value. The Weekly Reviews navigation reads this URL filter; selecting All removes it.


Coordinator student list and detail responses include `runningScoreAvg`: the average entry rating across completed `REVIEWED` weeks, rounded to two decimal places, on the 1-5 scale. It is `null` when no completed grades exist. Display a value such as `4.2 / 5`, or `Not yet graded`; partially reviewed submitted weeks are excluded.


Admin overview includes `weeks_submitted_this_week`, counting distinct weekly submission records whose `submitted_at` falls within the current Monday-Sunday week in the application timezone. Reviewed and returned weeks remain counted; pending-review count is a separate metric. The admin dashboard refreshes statistics every 15 seconds and on window focus. The existing rate is labelled overall submission rate because it does not measure timeliness.
