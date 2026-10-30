from datetime import date, datetime, time, timedelta
from io import StringIO
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from django.core.management import call_command
from rest_framework.test import APIClient

from backend.auth.models import CoordinatorProfile, Department, LogrAccount, Programme, StudentProfile
from .models import Cohort, ExtensionRequest, InAppNotification, SupervisorDetails, WeeklySubmission
from .notifications import create_scheduled_notifications
from .views import assign_students


class CohortAssignmentTests(TestCase):
    def setUp(self):
        self.department = Department.objects.create(name="Computer Science")
        self.other_department = Department.objects.create(name="Physics")
        self.user = LogrAccount.objects.create_user("coordinator@example.com", "pass")
        self.coordinator = CoordinatorProfile.objects.create(
            user=self.user,
            department=self.department,
            programme=Programme.SWEP,
            phone="+2348000000000",
        )
        self.cohort = Cohort.objects.create(
            department=self.department,
            coordinator=self.coordinator,
            programme=Programme.SWEP,
            session="2026/2027",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=30),
        )

    def make_student(self, email, department, programme=Programme.SWEP, cohort=None):
        user = LogrAccount.objects.create_user(email, "pass")
        return StudentProfile.objects.create(
            user=user,
            matric_no=email,
            department=department,
            programme=programme,
            cohort=cohort,
        )

    def test_matching_students_are_assigned(self):
        matching = self.make_student("one@example.com", self.department)
        other_department = self.make_student("two@example.com", self.other_department)
        other_programme = self.make_student("three@example.com", self.department, Programme.SIWES)

        assign_students(self.cohort)

        matching.refresh_from_db()
        self.assertEqual(matching.cohort, self.cohort)
        self.assertEqual(matching.coordinator, self.coordinator)
        self.assertIsNone(other_department.cohort)
        self.assertIsNone(other_programme.cohort)

    def test_existing_assignment_is_not_replaced(self):
        other_cohort = Cohort.objects.create(
            department=self.department,
            coordinator=self.coordinator,
            programme=Programme.SWEP,
            session="2025/2026",
            start_date=date.today() - timedelta(days=60),
            end_date=date.today() - timedelta(days=30),
        )
        student = self.make_student("assigned@example.com", self.department, cohort=other_cohort)

        assign_students(self.cohort)

        student.refresh_from_db()
        self.assertEqual(student.cohort, other_cohort)

    def test_coordinator_can_see_saved_siwes_supervisor_details(self):
        student = self.make_student(
            "siwes@example.com", self.department, programme=Programme.SIWES
        )
        student.coordinator = self.coordinator
        student.save(update_fields=["coordinator"])
        SupervisorDetails.objects.create(
            student=student,
            name="Ada Supervisor",
            email="ada@example.com",
            phone="+2348000000000",
            organisation="Example Company",
        )
        client = APIClient()
        client.force_authenticate(self.user)

        list_response = client.get("/api/v1/coordinator/students/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["results"][0]["supervisorName"], "Ada Supervisor")

        detail_response = client.get(f"/api/v1/coordinator/students/{student.pk}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data["supervisor"], {
            "name": "Ada Supervisor",
            "email": "ada@example.com",
            "phone": "+2348000000000",
            "organisation": "Example Company",
        })

    def test_admin_reassignment_moves_students_and_deactivates_old_coordinator(self):
        student = self.make_student("move@example.com", self.department)
        student.coordinator = self.coordinator
        student.cohort = self.cohort
        student.save(update_fields=["coordinator", "cohort"])

        new_user = LogrAccount.objects.create_user("new@example.com", "pass")
        new_coordinator = CoordinatorProfile.objects.create(
            user=new_user,
            department=self.department,
            programme=Programme.SWEP,
            phone="+2348000000001",
        )
        admin = LogrAccount.objects.create_superuser("admin@example.com", "pass")
        client = APIClient()
        client.force_authenticate(admin)

        response = client.post(
            f"/api/v1/admin/coordinators/{self.coordinator.pk}/reassign/",
            {"new_coordinator_id": new_coordinator.pk},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        student.refresh_from_db()
        self.user.refresh_from_db()
        self.cohort.refresh_from_db()
        self.assertEqual(student.coordinator, new_coordinator)
        self.assertEqual(self.cohort.coordinator, new_coordinator)
        self.assertFalse(self.user.is_active)

    def test_student_requests_extension_and_coordinator_approves_it(self):
        student = self.make_student("extension@example.com", self.department)
        student.cohort = self.cohort
        student.coordinator = self.coordinator
        student.save(update_fields=["cohort", "coordinator"])
        week = WeeklySubmission.objects.create(
            student=student,
            cohort=self.cohort,
            week_no=1,
            deadline_at=timezone.now() - timedelta(days=1),
        )

        student_client = APIClient()
        student_client.force_authenticate(student.user)
        response = student_client.post(
            "/api/v1/student/logbook/weeks/1/extension-request/",
            {"reason": "I was unwell and could not complete the entries."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        extension = ExtensionRequest.objects.get(week=week)
        self.assertTrue(InAppNotification.objects.filter(
            user=self.user,
            trigger=InAppNotification.Trigger.EXTENSION_REQUESTED,
        ).exists())
        coordinator_client = APIClient()
        coordinator_client.force_authenticate(self.user)
        response = coordinator_client.post(
            f"/api/v1/coordinator/extension-requests/{extension.pk}/decision/",
            {"decision": "APPROVED", "days": 3},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        week.refresh_from_db()
        extension.refresh_from_db()
        self.assertEqual(extension.status, ExtensionRequest.Status.APPROVED)
        self.assertIsNotNone(week.extended_until)
        self.assertTrue(InAppNotification.objects.filter(
            user=student.user,
            trigger=InAppNotification.Trigger.EXTENSION_APPROVED,
        ).exists())

    def test_verified_signup_attaches_student_to_matching_cohort(self):
        pending_user = LogrAccount.objects.create_user(
            "signup@example.com",
            "pass",
            is_active=False,
            role=LogrAccount.Role.STUDENT,
        )
        cache.set("student-otp-signup@example.com", "123456", timeout=600)
        cache.set(
            "pending-student-signup-signup@example.com",
            {
                "matric_no": "CS-100",
                "department_id": self.department.pk,
                "programme": Programme.SWEP,
            },
            timeout=600,
        )
        client = APIClient()

        response = client.post(
            "/api/v1/auth/student/verify-otp/",
            {"email": pending_user.email, "otp": "123456"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        profile = StudentProfile.objects.get(user=pending_user)
        self.assertEqual(profile.cohort, self.cohort)
        self.assertEqual(profile.coordinator, self.coordinator)

    @patch("backend.management.management.commands.send_deadline_reminders.send_email")
    def test_deadline_reminder_is_sent_once_for_the_current_deadline(self, send_email):
        student = self.make_student("reminder@example.com", self.department)
        deadline = timezone.now() + timedelta(hours=24)
        WeeklySubmission.objects.create(
            student=student,
            cohort=self.cohort,
            week_no=1,
            deadline_at=deadline,
        )

        call_command("send_deadline_reminders", stdout=StringIO())
        call_command("send_deadline_reminders", stdout=StringIO())

        self.assertEqual(send_email.call_count, 1)
        week = WeeklySubmission.objects.get(student=student)
        self.assertIsNotNone(week.reminder_sent_for)

    def test_notifications_can_be_listed_and_marked_read_only_by_their_owner(self):
        own = InAppNotification.objects.create(
            user=self.user,
            trigger=InAppNotification.Trigger.WEEK_SUBMITTED_COORDINATOR,
            message="Week submitted.",
            link_to="/coordinator/students/1",
        )
        InAppNotification.objects.create(
            user=self.user,
            trigger=InAppNotification.Trigger.EXTENSION_REQUESTED,
            message="Extension requested.",
        )
        other_user = LogrAccount.objects.create_user("other@example.com", "pass")
        other_notification = InAppNotification.objects.create(
            user=other_user,
            trigger=InAppNotification.Trigger.WEEK_RETURNED,
            message="Your week was returned.",
        )

        client = APIClient()
        client.force_authenticate(self.user)
        response = client.get("/api/v1/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["unreadCount"], 2)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIn(str(own.pk), [item["id"] for item in response.data["results"]])

        response = client.post(f"/api/v1/notifications/{own.pk}/read/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["isRead"])

        response = client.post("/api/v1/notifications/read-all/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], 1)

        other_client = APIClient()
        other_client.force_authenticate(self.user)
        response = other_client.post(f"/api/v1/notifications/{other_notification.pk}/read/")
        self.assertEqual(response.status_code, 404)
        other_notification.refresh_from_db()
        self.assertFalse(other_notification.is_read)

    def test_scheduled_logbook_notifications_are_created_once(self):
        today = timezone.localdate()
        days_until_friday = (4 - today.weekday()) % 7 or 7
        friday = today + timedelta(days=days_until_friday)
        saturday = friday + timedelta(days=1)
        deadline = timezone.make_aware(datetime.combine(saturday, time(23, 59)))
        student = self.make_student("scheduled@example.com", self.department)
        week = WeeklySubmission.objects.create(
            student=student,
            cohort=self.cohort,
            week_no=1,
            deadline_at=deadline,
        )

        friday_afternoon = timezone.make_aware(datetime.combine(friday, time(15, 2)))
        self.assertEqual(create_scheduled_notifications(friday_afternoon), 1)
        self.assertEqual(create_scheduled_notifications(friday_afternoon), 0)
        self.assertEqual(InAppNotification.objects.filter(
            user=student.user,
            trigger=InAppNotification.Trigger.WEEK_UNSUBMITTED_FRIDAY,
        ).count(), 1)

        after_deadline = deadline + timedelta(minutes=5)
        create_scheduled_notifications(after_deadline)
        self.assertEqual(InAppNotification.objects.filter(
            user=student.user,
            trigger=InAppNotification.Trigger.WEEK_LOCKED,
        ).count(), 1)
        create_scheduled_notifications(after_deadline)
        week.refresh_from_db()
        self.assertEqual(InAppNotification.objects.filter(
            user=student.user,
            trigger=InAppNotification.Trigger.WEEK_LOCKED,
        ).count(), 1)


class TrainingLevelAndAttendanceTests(TestCase):
    def setUp(self):
        from .models import CohortDepartmentAssignment
        self.department = Department.objects.create(name="Level Test Department")
        self.coordinator_user = LogrAccount.objects.create_user("level-coordinator@example.com", "pass")
        self.coordinator = CoordinatorProfile.objects.create(user=self.coordinator_user,
            department=self.department, programme="SIWES", level=300, phone="123")
        self.cohorts = {}
        for level in (300, 400):
            cohort = Cohort.objects.create(programme="SIWES", level=level, session="2026/2027",
                start_date=timezone.localdate(), end_date=timezone.localdate() + timedelta(days=28))
            CohortDepartmentAssignment.objects.create(cohort=cohort, department=self.department,
                coordinator=self.coordinator if level == 300 else None)
            self.cohorts[level] = cohort

    def make_student(self, level):
        user = LogrAccount.objects.create_user(f"level-{level}@example.com", "pass")
        return StudentProfile.objects.create(user=user, matric_no=str(level), department=self.department,
            programme="SIWES", level=level, email_verified=True)

    def test_enrolment_separates_siwes_levels(self):
        from backend.auth.views import try_auto_assign
        third = self.make_student(300)
        fourth = self.make_student(400)
        assign_students(self.cohorts[300])
        try_auto_assign(fourth)
        third.refresh_from_db()
        fourth.refresh_from_db()
        self.assertEqual(third.cohort, self.cohorts[300])
        self.assertEqual(third.coordinator, self.coordinator)
        self.assertEqual(fourth.cohort, self.cohorts[400])
        self.assertIsNone(fourth.coordinator)

    def test_accepting_invite_assigns_only_matching_level(self):
        import secrets
        from backend.auth.models import CoordinatorInvitation
        from .models import CohortDepartmentAssignment
        fourth = self.make_student(400)
        assign_students(self.cohorts[400])
        invitation = CoordinatorInvitation.objects.create(email="fourth-coordinator@example.com",
            department=self.department, programme="SIWES", level=400, token=secrets.token_urlsafe(32))
        response = APIClient().post("/api/v1/invitations/accept/", {
            "token": invitation.token, "first_name": "Fourth", "last_name": "Coordinator",
            "phone": "08012345678", "password": "StrongExample!3427",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        fourth.refresh_from_db()
        self.assertEqual(fourth.coordinator.level, 400)
        self.assertEqual(CohortDepartmentAssignment.objects.get(cohort=self.cohorts[300]).coordinator, self.coordinator)

    def test_wrong_level_coordinator_assignment_is_rejected(self):
        admin = LogrAccount.objects.create_superuser("levels-admin@example.com", "pass")
        client = APIClient()
        client.force_authenticate(admin)
        response = client.patch(f"/api/v1/admin/cohorts/{self.cohorts[400].pk}/departments/{self.department.pk}/coordinator/",
            {"coordinator_id": self.coordinator.pk}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_code_checkin_updates_history_and_coordinator_count(self):
        from .models import CohortDepartmentAssignment
        student = self.make_student(200)
        student.programme = "SWEP"
        self.coordinator.programme = "SWEP"
        self.coordinator.level = 200
        self.coordinator.save()
        cohort = Cohort.objects.create(programme="SWEP", level=200, session="2026/2027",
            start_date=timezone.localdate(), end_date=timezone.localdate() + timedelta(days=28),
            working_days=list(range(7)))
        CohortDepartmentAssignment.objects.create(cohort=cohort, department=self.department, coordinator=self.coordinator)
        student.cohort = cohort
        student.coordinator = self.coordinator
        student.save()
        coordinator_client = APIClient()
        coordinator_client.force_authenticate(self.coordinator_user)
        created = coordinator_client.post("/api/v1/coordinator/attendance/sessions/", {"minutes": 3}, format="json")
        self.assertEqual(created.status_code, 201)
        client = APIClient()
        client.force_authenticate(student.user)
        self.assertFalse(client.get("/api/v1/student/attendance/history/").data["checked_in_today"])
        for expected_status in (201, 200):
            submitted = client.post("/api/v1/student/attendance/", {"code": created.data["code"]}, format="json")
            self.assertEqual(submitted.status_code, expected_status)
        self.assertTrue(client.get("/api/v1/student/attendance/history/").data["checked_in_today"])
        current = coordinator_client.get("/api/v1/coordinator/attendance/sessions/current/")
        self.assertEqual(current.data["present_count"], 1)
        self.assertEqual(current.data["total_students"], 1)
        self.assertEqual(current.data["records"][0]["status"], "present")


class AutomaticCoordinatorEnrollmentTests(TestCase):
    def setUp(self):
        from backend.auth.models import Faculty
        self.faculty = Faculty.objects.create(name="Enrollment Faculty", code="ENROL")
        self.department = Department.objects.create(name="Enrollment Department", faculty=self.faculty)
        self.other_department = Department.objects.create(name="Other Enrollment Department", faculty=self.faculty)
        self.client = APIClient()
        self.client.force_authenticate(LogrAccount.objects.create_superuser("enrollment-admin@example.com", "pass"))
        self.serial = 0

    def coordinator(self, programme="SWEP", level=None, department=None, active=True):
        self.serial += 1
        user = LogrAccount.objects.create_user(f"enrollment-coordinator-{self.serial}@example.com", "pass", is_active=active, role=LogrAccount.Role.COORDINATOR)
        return CoordinatorProfile.objects.create(user=user, department=department or self.department,
            programme=programme, level=level, phone="123")

    def student(self, programme="SWEP", level=None, department=None):
        self.serial += 1
        user = LogrAccount.objects.create_user(f"enrollment-student-{self.serial}@example.com", "pass")
        return StudentProfile.objects.create(user=user, matric_no=f"ENROL-{self.serial}",
            programme=programme, level=level, department=department or self.department, email_verified=True)

    def create_cohort(self, programme="SWEP", level=200):
        response = self.client.post("/api/v1/admin/cohorts/", {
            "faculty_id": self.faculty.pk, "department_ids": [self.department.pk, self.other_department.pk],
            "programme": programme, "level": level, "session": "2026/2027",
            "start_date": str(timezone.localdate()), "end_date": str(timezone.localdate() + timedelta(days=30)),
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Cohort.objects.get(pk=response.data["id"])

    def test_swep_assigns_existing_coordinators_and_students_by_department_and_programme(self):
        coordinator = self.coordinator()
        other_coordinator = self.coordinator(department=self.other_department)
        self.coordinator(programme="SIWES", level=300)
        student = self.student()
        other_student = self.student(department=self.other_department)
        siwes_student = self.student(programme="SIWES", level=300)
        cohort = self.create_cohort()
        for student, expected in [(student, coordinator), (other_student, other_coordinator)]:
            student.refresh_from_db()
            self.assertEqual(student.cohort, cohort)
            self.assertEqual(student.coordinator, expected)
        siwes_student.refresh_from_db()
        self.assertIsNone(siwes_student.cohort)
        self.assertEqual(cohort.department_assignments.get(department=self.department).coordinator, coordinator)

    def test_siwes_separates_coordinators_and_students_by_level(self):
        coordinators = {level: self.coordinator("SIWES", level) for level in (300, 400)}
        students = {level: self.student("SIWES", level) for level in (300, 400)}
        for level in (300, 400):
            cohort = self.create_cohort("SIWES", level)
            students[level].refresh_from_db()
            self.assertEqual(students[level].cohort, cohort)
            self.assertEqual(students[level].coordinator, coordinators[level])
        self.assertNotEqual(students[300].cohort, students[400].cohort)

    def test_inactive_coordinators_are_not_assigned(self):
        self.coordinator(active=False)
        cohort = self.create_cohort()
        self.assertIsNone(cohort.department_assignments.get(department=self.department).coordinator)

    def test_multiple_matches_require_manual_choice_without_replacing_other_assignments(self):
        from .views import auto_assign_coordinators
        first = self.coordinator()
        self.coordinator()
        student = self.student()
        cohort = self.create_cohort()
        assignment = cohort.department_assignments.get(department=self.department)
        self.assertIsNone(assignment.coordinator)
        student.refresh_from_db()
        self.assertEqual(student.cohort, cohort)
        self.assertIsNone(student.coordinator)
        users = self.client.get("/api/v1/admin/users/?role=coordinator")
        self.assertEqual(users.status_code, 200)
        selected = next(item for item in users.data["results"] if item["email"] == first.user.email)
        self.assertEqual(selected["coordinator_profile"]["id"], first.pk)
        response = self.client.patch(
            f"/api/v1/admin/cohorts/{cohort.pk}/departments/{self.department.pk}/coordinator/",
            {"coordinator_id": first.pk}, format="json")
        self.assertEqual(response.status_code, 200)
        auto_assign_coordinators(cohort)
        assignment.refresh_from_db()
        student.refresh_from_db()
        self.assertEqual(assignment.coordinator, first)
        self.assertEqual(student.coordinator, first)

    def test_student_joining_after_swep_creation_uses_department_and_programme(self):
        from backend.auth.views import try_auto_assign
        coordinator = self.coordinator()
        cohort = self.create_cohort()
        student = self.student()
        try_auto_assign(student)
        student.refresh_from_db()
        self.assertEqual(student.cohort, cohort)
        self.assertEqual(student.coordinator, coordinator)


class PartialWeekSubmissionTests(TestCase):
    def test_midweek_start_requires_only_training_dates_and_still_rejects_missing_entries(self):
        from datetime import timezone as datetime_timezone
        from .models import LogbookEntry
        fixed_now = datetime(2026, 10, 30, 12, tzinfo=datetime_timezone.utc)
        department = Department.objects.create(name="Partial Week Department")
        user = LogrAccount.objects.create_user("partial-week@example.com", "pass")
        cohort = Cohort.objects.create(programme="SIWES", level=300, session="2026/2027",
            start_date=date(2026, 10, 28), end_date=date(2026, 11, 20))
        student = StudentProfile.objects.create(user=user, matric_no="PARTIAL-1", department=department,
            programme="SIWES", level=300, cohort=cohort, email_verified=True)
        client = APIClient()
        client.force_authenticate(user)
        with patch("backend.management.views.timezone.now", return_value=fixed_now):
            initial = client.get("/api/v1/student/logbook/weeks/1/")
            self.assertEqual(initial.status_code, 200)
            self.assertEqual(initial.data["totalWorkingDayCount"], 3)
            self.assertEqual([day["date"] for day in initial.data["days"]],
                ["2026-10-28", "2026-10-29", "2026-10-30"])
            week = WeeklySubmission.objects.get(pk=initial.data["id"])
            for day in (date(2026, 10, 28), date(2026, 10, 29)):
                LogbookEntry.objects.create(student=student, week=week, entry_date=day,
                    activities="Completed practical training tasks and documented the results.")
            incomplete = client.get("/api/v1/student/logbook/weeks/1/")
            self.assertFalse(incomplete.data["canSubmit"])
            rejected = client.post("/api/v1/student/logbook/weeks/1/", {}, format="json")
            self.assertEqual(rejected.status_code, 400)
            self.assertEqual(rejected.data["details"]["missing_days"], ["2026-10-30"])
            LogbookEntry.objects.create(student=student, week=week, entry_date=date(2026, 10, 30),
                activities="Completed practical training tasks and documented the results.")
            complete = client.get("/api/v1/student/logbook/weeks/1/")
            self.assertTrue(complete.data["canSubmit"])
            self.assertEqual(complete.data["filledDayCount"], 3)
            submitted = client.post("/api/v1/student/logbook/weeks/1/", {}, format="json")
            self.assertEqual(submitted.status_code, 200)
            self.assertEqual(submitted.data["status"], "submitted")

    def test_end_date_and_holidays_reduce_required_days(self):
        from .models import CohortHoliday
        from .views import cohort_working_dates
        cohort = Cohort.objects.create(programme="SIWES", level=300, session="2026/2027",
            start_date=date(2026, 10, 28), end_date=date(2026, 11, 3))
        CohortHoliday.objects.create(cohort=cohort, date=date(2026, 10, 29), label="Training holiday")
        self.assertEqual(cohort_working_dates(cohort, 1), [date(2026, 10, 28), date(2026, 10, 30)])
        self.assertEqual(cohort_working_dates(cohort, 2), [date(2026, 11, 2), date(2026, 11, 3)])


class WeeklyReviewFilterTests(TestCase):
    setUp = CohortAssignmentTests.setUp
    make_student = CohortAssignmentTests.make_student

    def test_weekly_reviews_only_returns_own_students_with_submitted_weeks(self):
        waiting = self.make_student("waiting-review@example.com", self.department, cohort=self.cohort)
        draft = self.make_student("draft-review@example.com", self.department, cohort=self.cohort)
        unrelated = self.make_student("unrelated-review@example.com", self.other_department)
        for student in (waiting, draft):
            student.coordinator = self.coordinator
            student.save(update_fields=["coordinator"])
        for student, state in [(waiting, "SUBMITTED"), (draft, "OPEN"), (unrelated, "SUBMITTED")]:
            WeeklySubmission.objects.create(student=student, cohort=self.cohort, week_no=1,
                status=state, deadline_at=timezone.now() + timedelta(days=1))
        client = APIClient()
        client.force_authenticate(self.user)
        response = client.get("/api/v1/coordinator/students/?filter=needs_review")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.data["results"]], [waiting.pk])
        self.assertEqual(response.data["results"][0]["pendingReviewCount"], 1)
        self.assertEqual(response.data["results"][0]["status"], "needs_review")
        self.assertEqual(len(client.get("/api/v1/coordinator/students/").data["results"]), 2)


class CoordinatorScoreTests(TestCase):
    setUp = CohortAssignmentTests.setUp
    make_student = CohortAssignmentTests.make_student

    def test_list_and_detail_show_reviewed_scores_and_no_grade_placeholder(self):
        from .models import EntryReview, LogbookEntry
        student = self.make_student("graded-score@example.com", self.department, cohort=self.cohort)
        ungraded = self.make_student("ungraded-score@example.com", self.department, cohort=self.cohort)
        for profile in (student, ungraded):
            profile.coordinator = self.coordinator
            profile.save(update_fields=["coordinator"])
        reviewed = WeeklySubmission.objects.create(student=student, cohort=self.cohort, week_no=1,
            status="REVIEWED", deadline_at=timezone.now() + timedelta(days=7))
        pending = WeeklySubmission.objects.create(student=student, cohort=self.cohort, week_no=2,
            status="SUBMITTED", deadline_at=timezone.now() + timedelta(days=14))
        for offset, (week, rating) in enumerate([(reviewed, 3), (reviewed, 5), (pending, 1)]):
            entry = LogbookEntry.objects.create(student=student, week=week,
                entry_date=timezone.localdate() + timedelta(days=offset), activities="Graded activity")
            EntryReview.objects.create(entry=entry, coordinator=self.coordinator, rating=rating)
        client = APIClient()
        client.force_authenticate(self.user)
        listing = client.get("/api/v1/coordinator/students/")
        self.assertEqual(listing.status_code, 200)
        scores = {row["id"]: row["runningScoreAvg"] for row in listing.data["results"]}
        self.assertEqual(scores[student.pk], 4)
        self.assertIsNone(scores[ungraded.pk])
        for profile, expected in [(student, 4), (ungraded, None)]:
            detail = client.get(f"/api/v1/coordinator/students/{profile.pk}/")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.data["runningScoreAvg"], expected)


class AdminSubmissionCounterTests(TestCase):
    setUp = CohortAssignmentTests.setUp
    make_student = CohortAssignmentTests.make_student

    def test_weekly_counter_uses_submission_dates_and_survives_review(self):
        from datetime import timezone as datetime_timezone
        student = self.make_student("admin-counter@example.com", self.department, cohort=self.cohort)
        client = APIClient()
        client.force_authenticate(LogrAccount.objects.create_superuser("counter-admin@example.com", "pass"))
        timestamps = [
            ("SUBMITTED", datetime(2026, 10, 25, 23, tzinfo=datetime_timezone.utc)),
            ("RETURNED", datetime(2026, 10, 30, 8, tzinfo=datetime_timezone.utc)),
            ("REVIEWED", datetime(2026, 10, 25, 22, 59, 59, tzinfo=datetime_timezone.utc)),
            ("REVIEWED", datetime(2026, 11, 1, 23, tzinfo=datetime_timezone.utc)),
            ("OPEN", None),
        ]
        weeks = []
        for number, (state, submitted_at) in enumerate(timestamps, 1):
            weeks.append(WeeklySubmission.objects.create(student=student, cohort=self.cohort,
                week_no=number, status=state, submitted_at=submitted_at,
                deadline_at=timezone.now() + timedelta(days=7)))
        fixed_now = datetime(2026, 10, 30, 12, tzinfo=datetime_timezone.utc)
        with timezone.override("Africa/Lagos"), patch("backend.management.views.timezone.now", return_value=fixed_now):
            response = client.get("/api/v1/admin/overview/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["weeks_submitted_this_week"], 2)
            self.assertEqual(response.data["weeks_waiting_for_review"], 1)
            weeks[0].status = "REVIEWED"
            weeks[0].save(update_fields=["status"])
            reviewed = client.get("/api/v1/admin/overview/")
            self.assertEqual(reviewed.data["weeks_submitted_this_week"], 2)
            self.assertEqual(reviewed.data["weeks_waiting_for_review"], 0)
