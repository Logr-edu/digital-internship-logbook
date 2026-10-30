# Logr: Presentation Brief

## Project overview
**Logr** is a web-based digital internship logbook for Obafemi Awolowo University students. It supports **SWEP (200L)** and **SIWES (300L and 400L)**, connecting students, academic coordinators, administrators, and workplace supervisors.

**Problem:** Paper logbooks make activity tracking, attendance verification, submission monitoring, and supervisor feedback difficult to manage centrally.

**Objective:** Provide one platform for documenting practical training, monitoring progress, and reviewing student work.

## Highlighted features
- **Student logbooks:** Daily activities, skills, reflections, autosave, photo attachments, and weekly submissions.
- **Programme-aware cohorts:** Automatic student enrolment and coordinator assignment by department and programme; SIWES additionally matches level. Multiple matching coordinators require an administrator's choice.
- **SWEP attendance:** Short-lived codes, student check-in, coordinator counts and rosters, and manual attendance overrides.
- **Academic assessment:** Coordinator reviews, grading, feedback, corrections, deadlines, and extension requests.
- **SIWES supervision:** Workplace supervisors review and sign logbooks through secure emailed links without registering an account.
- **Administration and communication:** Coordinator invitations, account oversight, reports, in-app notifications, reminders, and branded email cards with action buttons.
- **Access control:** Email OTP verification, JWT authentication, role-based API permissions, and private media served through short-lived signed URLs.

## System architecture
**Browser → Next.js frontend → Django REST API → PostgreSQL database**

The frontend provides role-specific dashboards and communicates with versioned API endpoints under `/api/v1/`. The backend applies validation, permissions, assignment rules, and assessment workflows.

Supporting services:
- **Cloudinary:** Logbook photos and drawn supervisor signatures.
- **Gmail API + OAuth 2.0:** Verification codes, invitations, supervisor links, and reminders.
- **Django cache:** Temporary codes and pending signup state.
- **Render Cron Job:** Runs the deadline-reminder management command on a schedule.

## Technical requirements
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4; Node.js and npm for development/builds.
- **Backend:** Python compatible with the pinned Django version, Django 6.1, Django REST Framework, and SimpleJWT.
- **Storage:** PostgreSQL for deployment; SQLite is available for local development.
- **Configuration:** Database connection, Django secret, frontend/backend origins, Gmail OAuth credentials, and `CLOUDINARY_URL`; apply migrations before running updated code.
- **User access:** A modern phone or desktop browser and internet connection.

## Development/report summary
Development followed iterative implementation of authentication, cohorts, logbooks, attendance, assessment, supervisor reviews, and deployment configuration. Verification includes backend regression tests and TypeScript checks; these do not establish complete browser or live-service testing.

**Documentation:** `README.md` (overview), `TECHNICAL_REPORT_HANDOFF.md` (report material), `FRONTEND_GUIDE.md` (API integration), `backend/README.md` (setup), and `DEPLOYMENT_TO_DO.md` (deployment).

## Instruction for the slide-generation AI
Create **7 concise slides**: problem/objective, users, key features, architecture, technology/requirements, development/testing, and benefits/next steps. Use the information above; do not invent usage statistics, research findings, or completed deployment claims. Use Logr's orange `#F04D23`, charcoal `#141414`, warm neutral `#EDECE6`, and Plus Jakarta Sans. Emphasize centralized records, easier supervision, and clearer training progress as intended benefits.
