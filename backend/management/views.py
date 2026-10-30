import secrets
import csv
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.db.models import Avg, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from backend.auth.email_service import EmailDeliveryError, send_email
from backend.auth.models import CoordinatorProfile, Department, DegreeProgramme, Faculty, LogrAccount, Programme, StudentProfile
from .models import (
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    Cohort,
    CohortDepartmentAssignment,
    EntryReview,
    ExtensionRequest,
    InAppNotification,
    LogbookEntry,
    LogbookPhoto,
    SupervisorDetails,
    SupervisorReview,
    SupervisorReviewToken,
    SupervisorReviewWeek,
    WeeklySubmission,
)
from .serializers import (
    AccountStatusSerializer,
    AttendanceCodeSerializer,
    AttendanceOverrideSerializer,
    AttendanceSessionCreateSerializer,
    CohortSerializer,
    DayEntrySerializer,
    ExtensionDecisionSerializer,
    ExtensionRequestSerializer,
    InAppNotificationSerializer,
    EntryReviewSerializer,
    ProgrammeSerializer,
    ReturnWeekSerializer,
    SupervisorDetailsSerializer,
    SupervisorReviewSubmitSerializer,
)
from .notifications import create_notification


ATTENDANCE_CODE_PREFIX = "attendance-code-"
ATTENDANCE_TRIES_PREFIX = "attendance-tries-"
ATTENDANCE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_ATTENDANCE_ATTEMPTS = 5


def server_time():
    return timezone.now().isoformat()


def account_name(user):
    return f"{user.first_name} {user.last_name}".strip()


def supervisor_signature_url(review):
    if not review.signature_key:
        return None
    try:
        from cloudinary.utils import private_download_url

        expires_at = int((timezone.now() + timedelta(minutes=5)).timestamp())
        return private_download_url(
            review.signature_key,
            "png",
            resource_type="image",
            type="authenticated",
            secure=True,
            expires_at=expires_at,
        )
    except Exception:
        return None


def private_photo_url(cloudinary_key, file_format):
    try:
        from cloudinary.utils import private_download_url

        expires_at = int((timezone.now() + timedelta(minutes=5)).timestamp())
        return private_download_url(
            cloudinary_key,
            file_format,
            resource_type="image",
            type="authenticated",
            secure=True,
            expires_at=expires_at,
        )
    except Exception:
        return None


def api_error(code, message, http_status=status.HTTP_400_BAD_REQUEST, details=None):
    body = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return Response(body, status=http_status)


def get_student(user):
    try:
        return StudentProfile.objects.select_related("user", "department", "cohort").get(user=user)
    except StudentProfile.DoesNotExist:
        return None


def get_coordinator(user):
    try:
        return CoordinatorProfile.objects.select_related("user", "department").get(user=user)
    except CoordinatorProfile.DoesNotExist:
        return None


def record_audit(request, action, target, details=None):
    AuditLog.objects.create(
        actor=request.user if request.user.is_authenticated else None,
        action=action,
        target_type=target.__class__.__name__,
        target_id=target.pk,
        details=details or {},
    )


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        notifications = request.user.notifications.all()
        return Response({
            "results": InAppNotificationSerializer(notifications, many=True).data,
            "unreadCount": notifications.filter(is_read=False).count(),
        })


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def post(self, request, notification_id):
        notification = request.user.notifications.filter(pk=notification_id).first()
        if not notification:
            return api_error("not_found", "Notification was not found.", status.HTTP_404_NOT_FOUND)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(InAppNotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def post(self, request):
        updated = request.user.notifications.filter(is_read=False).update(is_read=True)
        return Response({"updated": updated})


def auto_assign_coordinators(cohort):
    """Assign an unambiguous active coordinator to each participating department."""
    if cohort.programme == Programme.SIWES and cohort.level not in (300, 400):
        return
    for assignment in cohort.department_assignments.filter(coordinator__isnull=True):
        candidates = CoordinatorProfile.objects.filter(
            department_id=assignment.department_id,
            programme=cohort.programme,
            user__is_active=True,
            user__status=LogrAccount.Status.ACTIVE,
        )
        if cohort.programme == Programme.SIWES:
            candidates = candidates.filter(level=cohort.level)
        matches = list(candidates.order_by("pk")[:2])
        if len(matches) == 1:
            assignment.coordinator = matches[0]
            assignment.save(update_fields=["coordinator"])
            sync_coordinator_to_students(assignment)


def assign_students(cohort):
    """Assign eligible students from all participating departments to this cohort.

    For each CohortDepartmentAssignment, enrol verified students from that
    department who are not yet in any cohort. Coordinator assignment on the
    student profile is set only when the dept assignment already has one;
    otherwise the coordinator field stays NULL until one is assigned later.
    """
    if cohort.programme == Programme.SIWES and cohort.level not in (300, 400):
        return
    assignments = cohort.department_assignments.select_related("department", "coordinator").all()
    if assignments.exists():
        # New-style multi-department cohort
        for assignment in assignments:
            students = StudentProfile.objects.filter(
                department=assignment.department,
                programme=cohort.programme,
                email_verified=True,
                cohort__isnull=True,
            )
            if cohort.programme == Programme.SIWES:
                students = students.filter(level=cohort.level)
            students.update(
                cohort=cohort,
                coordinator=assignment.coordinator,  # may be None – that is fine
            )
    elif cohort.department:
        # Legacy single-department cohort path (backward compat)
        students = StudentProfile.objects.filter(
            department=cohort.department,
            programme=cohort.programme,
            cohort__isnull=True,
        )
        if cohort.programme == Programme.SIWES:
            students = students.filter(level=cohort.level)
        students.update(cohort=cohort, coordinator=cohort.coordinator)


def sync_coordinator_to_students(assignment):
    """When a coordinator is assigned/updated for a dept in a cohort, update
    all enrolled students in that department and cohort."""
    StudentProfile.objects.filter(
        cohort=assignment.cohort,
        department=assignment.department,
    ).update(coordinator=assignment.coordinator)


def cohort_week_start(cohort, week_no):
    first_monday = cohort.start_date - timedelta(days=cohort.start_date.weekday())
    return first_monday + timedelta(weeks=week_no - 1)


def cohort_working_dates(cohort, week_no):
    week_start = cohort_week_start(cohort, week_no)
    dates = [week_start + timedelta(days=offset) for offset in range(7)]
    holidays = set(cohort.holidays.values_list("date", flat=True))
    return [
        day for day in dates
        if cohort.start_date <= day <= cohort.end_date
        and day.weekday() in cohort.working_days
        and day not in holidays
    ]


def week_deadline(cohort, week_no):
    week_start = cohort_week_start(cohort, week_no)
    deadline_date = week_start + timedelta(days=cohort.deadline_weekday)
    return timezone.make_aware(
        datetime.combine(deadline_date, cohort.deadline_time),
        timezone.get_current_timezone(),
    )


def get_or_create_week(student, week_no):
    deadline = week_deadline(student.cohort, week_no)
    week, _ = WeeklySubmission.objects.get_or_create(
        student=student,
        week_no=week_no,
        defaults={"cohort": student.cohort, "deadline_at": deadline},
    )
    return week


def effective_deadline(week):
    if week.status == WeeklySubmission.Status.RETURNED and week.correction_deadline:
        return week.correction_deadline
    if week.extended_until:
        return max(week.deadline_at, week.extended_until)
    return week.deadline_at


def extension_request_window_open(week):
    return timezone.now() <= week.deadline_at + timedelta(days=week.cohort.request_window_days)


def extension_status(week):
    request = week.extension_requests.order_by("-requested_at").first()
    if request:
        return {
            "status": request.status.lower(),
            "requestedAt": request.requested_at.isoformat(),
            "approvedUntil": request.approved_until.isoformat() if request.approved_until else None,
            "comment": request.decision_comment or None,
        }
    return None


def week_state(week, now=None):
    now = now or timezone.now()
    if week.status == WeeklySubmission.Status.OPEN and now > effective_deadline(week):
        return "MISSED"
    return week.status


def entry_is_filled(entry, cohort):
    return bool(entry and len(entry.activities.strip()) >= cohort.min_filled_chars)


def entry_response(entry, day, cohort, week):
    review = getattr(entry, "coordinator_review", None) if entry else None
    if not entry:
        state = "FUTURE" if day > timezone.localdate() else "NOT_FILLED"
    else:
        state = entry.status
    return {
        "id": entry.pk if entry else None,
        "date": day.isoformat(),
        "status": state.lower(),
        "activities": entry.activities if entry else "",
        "skillsLearned": entry.skills if entry else None,
        "myReview": entry.review_text if entry else None,
        "photos": [
            private_photo_url(photo.cloudinary_key, photo.file_format)
            for photo in entry.photos.all()
        ] if entry else [],
        "coordinatorComment": review.comment if review else None,
        "rating": review.rating if review else None,
        "isFilled": entry_is_filled(entry, cohort),
        "isWorkingDay": day in cohort_working_dates(cohort, week.week_no),
        "isHoliday": cohort.holidays.filter(date=day).exists(),
        "lastSavedAt": entry.updated_at.isoformat() if entry else None,
    }


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class IsCoordinator(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and get_coordinator(request.user))


class IsStudent(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and get_student(request.user))


# Cohort endpoints

def get_coordinator_cohorts(coordinator):
    """Return all cohorts where the coordinator has at least one dept assignment,
    plus legacy cohorts that use the old FK directly."""
    from django.db.models import Q
    return Cohort.objects.filter(
        Q(department_assignments__coordinator=coordinator) | Q(coordinator=coordinator)
    ).distinct().order_by("-start_date")


class CoordinatorCohortView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        coordinator = get_coordinator(request.user)
        cohorts = get_coordinator_cohorts(coordinator)
        return Response({"results": CohortSerializer(cohorts, many=True).data})


class CoordinatorCohortDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def patch(self, request, cohort_id):
        coordinator = get_coordinator(request.user)
        cohort = get_coordinator_cohorts(coordinator).filter(pk=cohort_id).first()
        if not cohort:
            return api_error("not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)

        serializer = CohortSerializer(cohort, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        has_entries = WeeklySubmission.objects.filter(cohort=cohort).exists()
        if has_entries and any(field in data for field in ("department", "programme")):
            return api_error("cohort_started", "Department and programme cannot change after students have logbook activity.")
        if has_entries and "start_date" in data:
            return api_error("cohort_started", "The cohort start date cannot change after logbook activity exists.")

        new_end_date = data.get("end_date")
        if has_entries and new_end_date and new_end_date < cohort.end_date:
            return api_error("cohort_started", "The cohort end date can only be moved later.")

        holiday_dates = data.get("holidays")
        if holiday_dates is not None and LogbookEntry.objects.filter(
            week__cohort=cohort,
            entry_date__in=holiday_dates,
        ).exists():
            return api_error("holiday_has_entry", "A holiday cannot be added to a date with a saved entry.")

        with transaction.atomic():
            serializer.save()
            record_audit(request, "COHORT_UPDATED", cohort)

        return Response(CohortSerializer(cohort).data)


class CurrentCohortView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        student = get_student(request.user)
        if not student.cohort:
            return Response({"server_time": server_time(), "cohort": None})

        today = timezone.localdate()
        has_started = today >= student.cohort.start_date
        days_from_start = (today - student.cohort.start_date).days
        days_until_start = (student.cohort.start_date - today).days if not has_started else 0

        week_no = (
            min(
                student.cohort.total_weeks,
                max(1, (days_from_start + student.cohort.start_date.weekday()) // 7 + 1),
            )
            if has_started
            else None
        )
        day_no = (
            min((student.cohort.end_date - student.cohort.start_date).days + 1, max(1, days_from_start + 1))
            if has_started
            else None
        )

        coordinator_name = None
        coordinator_email = None
        if student.coordinator and student.coordinator.user:
            coordinator_name = f"{student.coordinator.user.first_name} {student.coordinator.user.last_name}".strip()
            coordinator_email = student.coordinator.user.email

        cohort_data = CohortSerializer(student.cohort).data
        cohort_data["name"] = student.cohort.name or str(student.cohort)
        cohort_data["faculty"] = {
            "id": student.cohort.faculty.id,
            "name": student.cohort.faculty.name,
            "code": student.cohort.faculty.code,
        } if student.cohort.faculty else None
        cohort_data["department_name"] = student.department.name if student.department else None
        cohort_data["has_started"] = has_started
        cohort_data["days_until_start"] = max(0, days_until_start)
        cohort_data["has_coordinator"] = bool(student.coordinator)
        cohort_data["coordinator_name"] = coordinator_name
        cohort_data["coordinator_email"] = coordinator_email

        return Response({
            "server_time": server_time(),
            "cohort": cohort_data,
            "week_number": week_no,
            "day_number": day_no,
        })


class AdminCohortListView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        cohorts = Cohort.objects.prefetch_related(
            "department_assignments__department",
            "department_assignments__coordinator__user",
        ).select_related("faculty", "department", "coordinator__user").order_by("-start_date")
        return Response({"results": [
            cohort_list_item(c) for c in cohorts
        ]})

    def post(self, request):
        """Admin creates a faculty-wide cohort with one or more participating departments."""
        faculty_id = request.data.get("faculty_id")
        dept_ids = request.data.get("department_ids", [])  # list of department PKs
        custom_name = request.data.get("name", "").strip()

        faculty = Faculty.objects.filter(pk=faculty_id).first() if faculty_id else None
        if not faculty:
            return api_error("faculty_not_found", "Faculty was not found.", status.HTTP_404_NOT_FOUND)
        if not dept_ids or not isinstance(dept_ids, list):
            return api_error("departments_required", "Select at least one participating department.")

        departments = list(Department.objects.filter(pk__in=dept_ids, faculty=faculty))
        if len(departments) != len(dept_ids):
            return api_error("department_not_found", "One or more departments were not found in the selected faculty.", status.HTTP_404_NOT_FOUND)

        payload = {k: v for k, v in request.data.items()
                   if k not in ("faculty_id", "department_ids", "name")}
        serializer = CohortSerializer(data=payload)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            cohort = serializer.save(faculty=faculty, name=custom_name or "")
            # cohort.save() auto-generates name if blank – re-save if custom provided
            if custom_name:
                cohort.name = custom_name
                cohort.save(update_fields=["name"])
            # Create per-department assignments (no coordinator yet)
            CohortDepartmentAssignment.objects.bulk_create([
                CohortDepartmentAssignment(cohort=cohort, department=dept)
                for dept in departments
            ])
            auto_assign_coordinators(cohort)
            assign_students(cohort)
            record_audit(request, "COHORT_CREATED", cohort, {
                "faculty_id": faculty.id,
                "department_ids": [d.id for d in departments],
            })

        return Response(cohort_list_item(cohort), status=status.HTTP_201_CREATED)


def cohort_list_item(cohort):
    """Build a response dict for a cohort listing."""
    dept_assignments = list(cohort.department_assignments.select_related(
        "department", "coordinator__user"
    ).all())
    # Fallback for legacy cohorts that have no department_assignments
    if not dept_assignments and cohort.department:
        departments = [{"id": cohort.department_id, "name": cohort.department.name, "coordinator": (
            {"id": cohort.coordinator_id, "email": cohort.coordinator.user.email,
             "name": f"{cohort.coordinator.user.first_name} {cohort.coordinator.user.last_name}".strip()}
            if cohort.coordinator else None
        )}]
    else:
        departments = [
            {
                "id": a.department_id,
                "name": a.department.name,
                "coordinator": {
                    "id": a.coordinator_id,
                    "email": a.coordinator.user.email,
                    "name": f"{a.coordinator.user.first_name} {a.coordinator.user.last_name}".strip(),
                } if a.coordinator else None,
            }
            for a in dept_assignments
        ]
    return {
        "id": cohort.pk,
        "name": cohort.name or str(cohort),
        "programme": cohort.programme,
        "level": cohort.level,
        "session": cohort.session,
        "faculty": {"id": cohort.faculty_id, "name": cohort.faculty.name, "code": cohort.faculty.code} if cohort.faculty else None,
        "departments": departments,
        "start_date": cohort.start_date.isoformat(),
        "end_date": cohort.end_date.isoformat(),
        "total_weeks": cohort.total_weeks,
        "status": cohort.status,
        "enrolled_students": cohort.students.count(),
        "created_at": cohort.created_at.isoformat(),
    }


class AdminCohortDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request, cohort_id):
        cohort = Cohort.objects.filter(pk=cohort_id).first()
        if not cohort:
            return api_error("not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)
        return Response(cohort_list_item(cohort))

    def patch(self, request, cohort_id):
        cohort = Cohort.objects.filter(pk=cohort_id).first()
        if not cohort:
            return api_error("not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)

        serializer = CohortSerializer(cohort, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        holiday_dates = serializer.validated_data.get("holidays")
        if holiday_dates is not None and LogbookEntry.objects.filter(
            week__cohort=cohort,
            entry_date__in=holiday_dates,
        ).exists():
            return api_error("holiday_has_entry", "A holiday cannot be added to a date with a saved entry.")

        with transaction.atomic():
            serializer.save()
            record_audit(request, "COHORT_UPDATED", cohort)

        return Response(cohort_list_item(cohort))


# SWEP attendance endpoints

class AdminCohortDepartmentAssignView(APIView):
    """Assign or unassign a coordinator to a department within a cohort."""
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def patch(self, request, cohort_id, department_id):
        cohort = Cohort.objects.filter(pk=cohort_id).first()
        if not cohort:
            return api_error("not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)

        assignment = CohortDepartmentAssignment.objects.filter(
            cohort=cohort, department_id=department_id
        ).first()
        if not assignment:
            return api_error(
                "department_not_in_cohort",
                "This department is not part of the cohort.",
                status.HTTP_404_NOT_FOUND,
            )

        coordinator_id = request.data.get("coordinator_id")  # None = unassign
        if coordinator_id is None:
            # Unassign coordinator from this department
            assignment.coordinator = None
            assignment.save(update_fields=["coordinator"])
            # Remove coordinator from students in this dept+cohort who had this coordinator
            StudentProfile.objects.filter(
                cohort=cohort, department_id=department_id
            ).update(coordinator=None)
            record_audit(request, "COHORT_DEPT_COORDINATOR_REMOVED", cohort, {
                "department_id": department_id,
            })
            return Response({"cohort_id": cohort_id, "department_id": department_id, "coordinator": None})

        candidates = CoordinatorProfile.objects.select_related("user").filter(
            pk=coordinator_id,
            department_id=department_id,
            programme=cohort.programme,
            user__is_active=True,
            user__status=LogrAccount.Status.ACTIVE,
        )
        if cohort.programme == Programme.SIWES:
            candidates = candidates.filter(level=cohort.level)
        coordinator = candidates.first()
        if not coordinator:
            return api_error(
                "coordinator_not_found",
                f"No {cohort.programme} coordinator found with that ID.",
                status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            assignment.coordinator = coordinator
            assignment.save(update_fields=["coordinator"])
            sync_coordinator_to_students(assignment)
            record_audit(request, "COHORT_DEPT_COORDINATOR_ASSIGNED", cohort, {
                "department_id": department_id,
                "coordinator_id": coordinator_id,
            })

        return Response({
            "cohort_id": cohort_id,
            "department_id": department_id,
            "coordinator": {
                "id": coordinator.pk,
                "email": coordinator.user.email,
                "name": f"{coordinator.user.first_name} {coordinator.user.last_name}".strip(),
            },
        })


class AttendanceSessionCreateView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request):
        coordinator = get_coordinator(request.user)
        serializer = AttendanceSessionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        today = timezone.localdate()
        # Find an active SWEP cohort where this coordinator is assigned to at least one department
        assignment = CohortDepartmentAssignment.objects.select_related("cohort").filter(
            coordinator=coordinator,
            cohort__programme=Programme.SWEP,
            cohort__start_date__lte=today,
            cohort__end_date__gte=today,
        ).first()
        # Also accept legacy cohorts that still use the old coordinator FK
        if not assignment:
            legacy_cohort = Cohort.objects.filter(
                coordinator=coordinator,
                programme=Programme.SWEP,
                start_date__lte=today,
                end_date__gte=today,
            ).first()
            cohort = legacy_cohort
        else:
            cohort = assignment.cohort

        if not cohort:
            return api_error("not_applicable", "An active SWEP cohort is required.", status.HTTP_403_FORBIDDEN)

        today = timezone.localdate()
        if today.weekday() not in cohort.working_days or cohort.holidays.filter(date=today).exists():
            return api_error("not_working_day", "Attendance codes can only be opened on a cohort working day.")

        minutes = serializer.validated_data["minutes"]
        if minutes > cohort.attendance_max_minutes:
            return api_error("invalid_duration", "The requested duration exceeds this cohort's attendance limit.")

        sessions_today = AttendanceSession.objects.filter(cohort=cohort, date=today).count()
        if sessions_today >= cohort.attendance_max_codes_per_day:
            return api_error("attendance_limit", "The daily attendance code limit has been reached.")

        now = timezone.now()
        with transaction.atomic():
            current = AttendanceSession.objects.select_for_update().filter(
                cohort=cohort,
                date=today,
                ended_at__isnull=True,
                expires_at__gt=now,
            )
            for old_session in current:
                old_session.ended_at = now
                old_session.save(update_fields=["ended_at"])
                cache.delete(ATTENDANCE_CODE_PREFIX + str(old_session.pk))

            code = "".join(secrets.choice(ATTENDANCE_CODE_ALPHABET) for _ in range(6))
            salt = secrets.token_hex(16)
            session = AttendanceSession.objects.create(
                cohort=cohort,
                date=today,
                code_hash=AttendanceSession.hash_code(salt, code),
                salt=salt,
                started_at=now,
                expires_at=now + timedelta(minutes=minutes),
                created_by=coordinator,
                duration_minutes=minutes,
            )
            cache.set(
                ATTENDANCE_CODE_PREFIX + str(session.pk),
                code,
                timeout=minutes * 60,
            )
            record_audit(request, "ATTENDANCE_SESSION_CREATED", session)

        return Response({
            "id": session.pk,
            "code": code,
            "expires_at": session.expires_at.isoformat(),
            "server_time": server_time(),
        }, status=status.HTTP_201_CREATED)


class CurrentAttendanceSessionView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        coordinator = get_coordinator(request.user)
        now = timezone.now()
        session = AttendanceSession.objects.filter(
            created_by=coordinator,
            date=timezone.localdate(),
            ended_at__isnull=True,
            expires_at__gt=now,
        ).order_by("-started_at").first()
        if not session:
            return Response({"session": None, "server_time": server_time()})

        code = cache.get(ATTENDANCE_CODE_PREFIX + str(session.pk))
        if not code:
            return api_error("attendance_code_unavailable", "The active code is no longer available. End this session and generate another.", status.HTTP_409_CONFLICT)

        students = StudentProfile.objects.filter(cohort=session.cohort, coordinator=coordinator).select_related("user")
        records = {record.student_id: record for record in AttendanceRecord.objects.filter(
            student__in=students, date=session.date,
        )}
        roster = [{
            "studentId": str(student.pk),
            "studentName": account_name(student.user),
            "matricNo": student.matric_no,
            "status": records[student.pk].status.lower() if student.pk in records else "absent",
            "reason": records[student.pk].reason if student.pk in records else "",
        } for student in students]
        return Response({
            "id": session.pk,
            "code": code,
            "total_students": len(roster),
            "records": roster,
            "seconds_left": max(0, int((session.expires_at - now).total_seconds())),
            "present_count": sum(row["status"] == "present" for row in roster),
            "expires_at": session.expires_at.isoformat(),
            "server_time": server_time(),
        })


class EndAttendanceSessionView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request, session_id):
        coordinator = get_coordinator(request.user)
        session = AttendanceSession.objects.filter(pk=session_id, created_by=coordinator).first()
        if not session:
            return api_error("not_found", "Attendance session was not found.", status.HTTP_404_NOT_FOUND)
        if session.ended_at is None:
            session.ended_at = timezone.now()
            session.save(update_fields=["ended_at"])
        cache.delete(ATTENDANCE_CODE_PREFIX + str(session.pk))
        return Response({"message": "Attendance session ended."})


class AttendanceSubmitView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def post(self, request):
        student = get_student(request.user)
        if student.programme != Programme.SWEP:
            return api_error("not_applicable", "Attendance is only available for SWEP students.", status.HTTP_403_FORBIDDEN)
        if not student.cohort:
            return api_error("attendance_closed", "No active attendance session was found.")

        serializer = AttendanceCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data["code"].upper()
        existing = AttendanceRecord.objects.filter(student=student, date=timezone.localdate()).first()
        if existing:
            return Response({"date": existing.date.isoformat(), "status": existing.status})

        now = timezone.now()
        session = AttendanceSession.objects.filter(
            cohort=student.cohort,
            date=timezone.localdate(),
            ended_at__isnull=True,
            expires_at__gt=now,
        ).order_by("-started_at").first()
        if not session:
            return api_error("attendance_closed", "Attendance is not open right now.")

        tries_key = f"{ATTENDANCE_TRIES_PREFIX}{session.pk}:{student.pk}"
        attempts = cache.get(tries_key, 0)
        if attempts >= MAX_ATTENDANCE_ATTEMPTS:
            return api_error("too_many_attempts", "Too many incorrect codes for this session.", status.HTTP_429_TOO_MANY_REQUESTS)

        submitted_hash = AttendanceSession.hash_code(session.salt, code)
        if not secrets.compare_digest(submitted_hash, session.code_hash):
            cache.set(tries_key, attempts + 1, timeout=max(1, int((session.expires_at - now).total_seconds())))
            return api_error("code_invalid_or_expired", "The code is invalid or expired.")

        try:
            record = AttendanceRecord.objects.create(
                student=student,
                date=session.date,
                session=session,
                status=AttendanceRecord.Status.PRESENT,
                ip=self.get_client_ip(request),
            )
        except IntegrityError:
            record = AttendanceRecord.objects.get(student=student, date=session.date)

        cache.delete(tries_key)
        return Response({"date": record.date.isoformat(), "status": record.status}, status=status.HTTP_201_CREATED)

    @staticmethod
    def get_client_ip(request):
        return request.META.get("REMOTE_ADDR")


class AttendanceHistoryView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        student = get_student(request.user)
        if student.programme != Programme.SWEP:
            return api_error("not_applicable", "Attendance is only available for SWEP students.", status.HTTP_403_FORBIDDEN)
        if not student.cohort:
            return Response({"presentCount": 0, "totalCodedDays": 0, "records": [], "checked_in_today": False})

        records_by_date = {
            record.date: record
            for record in AttendanceRecord.objects.filter(student=student)
        }
        session_dates = set(
            AttendanceSession.objects.filter(cohort=student.cohort).values_list("date", flat=True)
        )
        for day in session_dates:
            if day not in records_by_date:
                records_by_date[day] = None

        records = []
        for day, record in sorted(records_by_date.items(), reverse=True):
            records.append({
                "date": day.isoformat(),
                "status": record.status if record else AttendanceRecord.Status.ABSENT,
                "excusedReason": record.reason if record and record.status == AttendanceRecord.Status.EXCUSED else None,
            })

        present_count = sum(1 for record in records if record["status"] == AttendanceRecord.Status.PRESENT)
        return Response({
            "checked_in_today": any(
                day == timezone.localdate() and record is not None
                and record.status in (AttendanceRecord.Status.PRESENT, AttendanceRecord.Status.EXCUSED)
                for day, record in records_by_date.items()
            ),
            "presentCount": present_count,
            "totalCodedDays": len(session_dates),
            "records": records,
        })


class AttendanceOverrideView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request, student_id):
        coordinator = get_coordinator(request.user)
        student = StudentProfile.objects.filter(
            pk=student_id,
            coordinator=coordinator,
            programme=Programme.SWEP,
        ).first()
        if not student:
            return api_error("not_found", "SWEP student was not found.", status.HTTP_404_NOT_FOUND)

        serializer = AttendanceOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        day = request.data.get("date")
        try:
            attendance_date = datetime.strptime(day, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            return api_error("invalid_date", "Provide an attendance date as YYYY-MM-DD.")

        record, _ = AttendanceRecord.objects.update_or_create(
            student=student,
            date=attendance_date,
            defaults={
                "status": serializer.validated_data["status"],
                "reason": serializer.validated_data["reason"],
                "marked_by": coordinator,
                "marked_at": timezone.now(),
            },
        )
        record_audit(request, "ATTENDANCE_OVERRIDDEN", record, {"reason": record.reason})
        return Response({"date": record.date.isoformat(), "status": record.status})


# Student logbook pages and weekly submission. These small endpoints supply the
# entries that coordinators grade below.

class StudentLogbookHomeView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        student = get_student(request.user)
        if not student.cohort:
            return Response({"server_time": server_time(), "currentWeek": None, "weekNumber": None})

        today = timezone.localdate()
        day_number = max(1, (today - student.cohort.start_date).days + 1)
        current_week_no = min(
            student.cohort.total_weeks,
            max(1, (day_number + student.cohort.start_date.weekday() - 1) // 7 + 1),
        )
        current_week = get_or_create_week(student, current_week_no)
        all_weeks = [get_or_create_week(student, no) for no in range(1, min(current_week_no, student.cohort.total_weeks) + 1)]

        avg = student.weeks.filter(status=WeeklySubmission.Status.REVIEWED).aggregate(
            avg=Avg("entries__coordinator_review__rating")
        )["avg"]
        running_score_avg = round(avg, 2) if avg is not None else None

        return Response({
            "server_time": server_time(),
            "currentWeek": self.week_payload(current_week),
            "weekNumber": current_week_no,
            "totalWeeks": student.cohort.total_weeks,
            "dayNumber": day_number,
            "totalDays": (student.cohort.end_date - student.cohort.start_date).days + 1,
            "runningScoreAvg": running_score_avg,
            "previousWeeks": [
                {
                    "id": week.pk,
                    "weekNumber": week.week_no,
                    "startDate": cohort_week_start(student.cohort, week.week_no).isoformat(),
                    "endDate": (cohort_week_start(student.cohort, week.week_no) + timedelta(days=6)).isoformat(),
                    "status": week_state(week).lower(),
                }
                for week in all_weeks if week.pk != current_week.pk
            ],
            "supervisorBatches": [],
        })

    @staticmethod
    def week_payload(week):
        cohort = week.cohort
        days = cohort_working_dates(cohort, week.week_no)
        entries = {entry.entry_date: entry for entry in week.entries.select_related("coordinator_review")}
        deadline = effective_deadline(week)
        filled_count = sum(entry_is_filled(entries.get(day), cohort) for day in days)
        missing_days = [day.isoformat() for day in days if not entry_is_filled(entries.get(day), cohort)]
        return {
            "id": week.pk,
            "weekNumber": week.week_no,
            "totalWeeks": cohort.total_weeks,
            "startDate": cohort_week_start(cohort, week.week_no).isoformat(),
            "endDate": (cohort_week_start(cohort, week.week_no) + timedelta(days=6)).isoformat(),
            "status": week_state(week).lower(),
            "days": [entry_response(entries.get(day), day, cohort, week) for day in days],
            "filledDayCount": filled_count,
            "totalWorkingDayCount": len(days),
            "deadline": {
                "datetime": deadline.isoformat(),
                "timeRemaining": str(max(timedelta(0), deadline - timezone.now())),
                "isPast": timezone.now() > deadline,
            },
            "submittedAt": week.submitted_at.isoformat() if week.submitted_at else None,
            "reviewedAt": week.reviewed_at.isoformat() if week.reviewed_at else None,
            "returnedAt": week.returned_at.isoformat() if week.returned_at else None,
            "correctionDeadline": week.correction_deadline.isoformat() if week.correction_deadline else None,
            "extension": extension_status(week),
            "isLateApproved": week.is_late,
            "canSubmit": bool(missing_days == [] and week.status in ("OPEN", "RETURNED") and timezone.now() <= deadline),
            "missingDays": missing_days,
        }


class StudentWeekView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request, week_no):
        student = get_student(request.user)
        if not student.cohort or week_no < 1 or week_no > student.cohort.total_weeks:
            return api_error("not_found", "Week was not found.", status.HTTP_404_NOT_FOUND)
        week = get_or_create_week(student, week_no)
        return Response(StudentLogbookHomeView.week_payload(week))

    def post(self, request, week_no):
        student = get_student(request.user)
        if not student.cohort or week_no < 1 or week_no > student.cohort.total_weeks:
            return api_error("not_found", "Week was not found.", status.HTTP_404_NOT_FOUND)
        week = get_or_create_week(student, week_no)
        now = timezone.now()
        if week.status == WeeklySubmission.Status.SUBMITTED:
            return Response(StudentLogbookHomeView.week_payload(week))
        if now > effective_deadline(week):
            can_request = (
                week.status == WeeklySubmission.Status.OPEN
                and extension_request_window_open(week)
                and not week.extension_requests.filter(status=ExtensionRequest.Status.PENDING).exists()
                and week.extension_requests.filter(status=ExtensionRequest.Status.APPROVED).count()
                < week.cohort.max_extensions_per_week
            )
            return api_error(
                "deadline_passed",
                "The submission deadline has passed.",
                details={"can_request_extension": can_request},
            )

        dates = cohort_working_dates(week.cohort, week.week_no)
        entries = {entry.entry_date: entry for entry in week.entries.all()}
        missing = [day.isoformat() for day in dates if not entry_is_filled(entries.get(day), week.cohort)]
        if missing:
            return api_error("days_not_filled", "Fill every working day before submitting.", details={"missing_days": missing})

        with transaction.atomic():
            week.status = WeeklySubmission.Status.SUBMITTED
            week.submitted_at = now
            week.correction_deadline = None
            week.save(update_fields=["status", "submitted_at", "correction_deadline"])
            week.entries.update(status=LogbookEntry.Status.SUBMITTED)

        if student.coordinator:
            create_notification(
                student.coordinator.user,
                InAppNotification.Trigger.WEEK_SUBMITTED_COORDINATOR,
                f"{account_name(student.user)} submitted week {week.week_no} for review.",
                link_to=f"/coordinator/students/{student.pk}",
                dedupe_key=f"week_submitted:{week.pk}:{week.submitted_at.isoformat()}",
            )

        return Response(StudentLogbookHomeView.week_payload(week))


class StudentExtensionRequestView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def post(self, request, week_no):
        student = get_student(request.user)
        if not student.cohort or week_no < 1 or week_no > student.cohort.total_weeks:
            return api_error("not_found", "Week was not found.", status.HTTP_404_NOT_FOUND)
        week = get_or_create_week(student, week_no)
        now = timezone.now()
        approved_count = week.extension_requests.filter(status=ExtensionRequest.Status.APPROVED).count()
        if week.status != WeeklySubmission.Status.OPEN or now <= effective_deadline(week):
            return api_error("extension_not_available", "Request an extension after the deadline has passed.")
        if not extension_request_window_open(week):
            return api_error("extension_window_closed", "The extension request window has closed.")
        if approved_count >= week.cohort.max_extensions_per_week:
            return api_error("extension_limit", "The extension limit for this week has been reached.")
        if week.extension_requests.filter(status=ExtensionRequest.Status.PENDING).exists():
            return api_error("extension_pending", "This week already has an extension request awaiting review.")

        serializer = ExtensionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        extension = ExtensionRequest.objects.create(
            week=week,
            reason=serializer.validated_data["reason"],
        )
        record_audit(request, "EXTENSION_REQUESTED", extension)
        if student.coordinator:
            create_notification(
                student.coordinator.user,
                InAppNotification.Trigger.EXTENSION_REQUESTED,
                f"{account_name(student.user)} requested an extension for week {week.week_no}.",
                link_to="/coordinator/extensions",
                dedupe_key=f"extension_requested:{extension.pk}",
            )
        return Response({
            "id": extension.pk,
            "status": extension.status.lower(),
            "requested_at": extension.requested_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class CoordinatorExtensionRequestListView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        coordinator = get_coordinator(request.user)
        requests = ExtensionRequest.objects.select_related("week__student__user").filter(
            week__student__coordinator=coordinator,
            status=ExtensionRequest.Status.PENDING,
        ).order_by("requested_at")
        return Response({"results": [
            {
                "id": item.pk,
                "student_id": item.week.student_id,
                "studentId": item.week.student_id,
                "student_name": f"{item.week.student.user.first_name} {item.week.student.user.last_name}".strip(),
                "studentName": f"{item.week.student.user.first_name} {item.week.student.user.last_name}".strip(),
                "matric_no": item.week.student.matric_no,
                "matricNo": item.week.student.matric_no,
                "week_id": item.week_id,
                "weekId": item.week_id,
                "week_number": item.week.week_no,
                "weekNumber": item.week.week_no,
                "reason": item.reason,
                "status": item.status,
                "requested_at": item.requested_at.isoformat(),
                "requestedAt": item.requested_at.isoformat(),
                "deadlineDate": item.week.deadline_date.isoformat() if getattr(item.week, "deadline_date", None) else None,
            }
            for item in requests[:100]
        ]})


class CoordinatorExtensionDecisionView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request, request_id):
        coordinator = get_coordinator(request.user)
        extension = ExtensionRequest.objects.select_related("week__cohort", "week__student__user").filter(
            pk=request_id,
            week__student__coordinator=coordinator,
            status=ExtensionRequest.Status.PENDING,
        ).first()
        if not extension:
            return api_error("not_found", "Pending extension request was not found.", status.HTTP_404_NOT_FOUND)

        serializer = ExtensionDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        extension.status = data["decision"]
        extension.reviewed_by = coordinator
        extension.reviewed_at = timezone.now()
        extension.decision_comment = data.get("comment", "")
        if extension.status == ExtensionRequest.Status.APPROVED:
            days = data["days"]
            if days > extension.week.cohort.max_grace_days:
                return api_error(
                    "extension_too_long",
                    f"An extension can be at most {extension.week.cohort.max_grace_days} days.",
                )
            extension.approved_until = timezone.now() + timedelta(days=days)
            extension.week.extended_until = extension.approved_until
            extension.week.save(update_fields=["extended_until"])
        extension.save(update_fields=[
            "status", "reviewed_by", "reviewed_at", "approved_until", "decision_comment",
        ])
        record_audit(request, "EXTENSION_DECIDED", extension, {
            "decision": extension.status,
            "approved_until": extension.approved_until.isoformat() if extension.approved_until else None,
        })
        trigger = (
            InAppNotification.Trigger.EXTENSION_APPROVED
            if extension.status == ExtensionRequest.Status.APPROVED
            else InAppNotification.Trigger.EXTENSION_DENIED
        )
        message = (
            f"Your extension request for week {extension.week.week_no} was approved."
            if extension.status == ExtensionRequest.Status.APPROVED
            else f"Your extension request for week {extension.week.week_no} was denied."
        )
        create_notification(
            extension.week.student.user,
            trigger,
            message,
            link_to=f"/student/week/{extension.week.week_no}",
            dedupe_key=f"extension_decided:{extension.pk}",
        )
        return Response({
            "id": extension.pk,
            "status": extension.status.lower(),
            "approved_until": extension.approved_until.isoformat() if extension.approved_until else None,
        })


class StudentDayView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request, entry_date):
        student = get_student(request.user)
        day, week, error_response = self.get_day_and_week(student, entry_date)
        if error_response:
            return error_response
        entry = LogbookEntry.objects.filter(student=student, entry_date=day).select_related("coordinator_review").first()
        payload = entry_response(entry, day, student.cohort, week)
        payload["editable"] = self.is_editable(week, day)
        return Response(payload)

    def put(self, request, entry_date):
        student = get_student(request.user)
        day, week, error_response = self.get_day_and_week(student, entry_date)
        if error_response:
            return error_response
        if not self.is_editable(week, day):
            return api_error("week_locked", "This logbook date is read-only.", status.HTTP_423_LOCKED)

        serializer = DayEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        entry, _ = LogbookEntry.objects.update_or_create(
            student=student,
            entry_date=day,
            defaults={
                "week": week,
                "activities": values["activities"],
                "skills": values.get("skills", ""),
                "review_text": values.get("review_text", ""),
                "status": LogbookEntry.Status.DRAFT,
            },
        )
        return Response({
            "updatedAt": entry.updated_at.isoformat(),
            "ready": entry_is_filled(entry, student.cohort),
            "canSubmit": StudentLogbookHomeView.week_payload(week)["canSubmit"],
        })

    @staticmethod
    def get_day_and_week(student, entry_date):
        if not student.cohort:
            return None, None, api_error("not_found", "No cohort is assigned to this account.", status.HTTP_404_NOT_FOUND)
        try:
            day = datetime.strptime(entry_date, "%Y-%m-%d").date()
        except ValueError:
            return None, None, api_error("invalid_date", "Use a date in YYYY-MM-DD format.")
        cohort = student.cohort
        today = timezone.localdate()
        if day > today:
            return None, None, api_error("future_day", "Future logbook dates are not available.")
        if day < cohort.start_date or day > cohort.end_date:
            return None, None, api_error("not_working_day", "This date is outside the cohort.")
        if day.weekday() not in cohort.working_days or cohort.holidays.filter(date=day).exists():
            return None, None, api_error("not_working_day", "This date is not a cohort working day.")
        week_no = (day - (cohort.start_date - timedelta(days=cohort.start_date.weekday()))).days // 7 + 1
        return day, get_or_create_week(student, week_no), None

    @staticmethod
    def is_editable(week, day):
        return (
            day <= timezone.localdate()
            and week.status in (WeeklySubmission.Status.OPEN, WeeklySubmission.Status.RETURNED)
            and timezone.now() <= effective_deadline(week)
        )


class StudentLogbookPhotoView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, entry_date):
        student = get_student(request.user)
        day, week, error_response = StudentDayView.get_day_and_week(student, entry_date)
        if error_response:
            return error_response
        if not StudentDayView.is_editable(week, day):
            return api_error("week_locked", "This logbook date is read-only.", status.HTTP_423_LOCKED)

        entry = LogbookEntry.objects.filter(student=student, entry_date=day).first()
        if not entry:
            return api_error("entry_required", "Save the day's logbook entry before adding a photo.")
        if entry.photos.count() >= 5:
            return api_error("photo_limit", "A logbook day can have at most five photos.")
        photo = request.FILES.get("photo")
        if not photo:
            return api_error("photo_required", "Choose a PNG, JPEG, or WebP image.")
        if photo.size > 5 * 1024 * 1024:
            return api_error("photo_too_large", "Each photo must be 5 MB or smaller.")

        header = photo.read(12)
        photo.seek(0)
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            file_format = "png"
        elif header.startswith(b"\xff\xd8\xff"):
            file_format = "jpg"
        elif header.startswith(b"RIFF") and header[8:12] == b"WEBP":
            file_format = "webp"
        else:
            return api_error("photo_type_invalid", "Choose a valid PNG, JPEG, or WebP image.")

        try:
            import cloudinary
            from cloudinary.uploader import upload

            if not cloudinary.config().cloud_name:
                raise RuntimeError("Cloudinary is not configured")
            uploaded = upload(
                photo,
                folder="logr/logbook-photos",
                resource_type="image",
                type="authenticated",
            )
        except Exception:
            return api_error(
                "photo_upload_failed",
                "The photo could not be saved. Try again later.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        saved_photo = LogbookPhoto.objects.create(
            entry=entry,
            cloudinary_key=uploaded["public_id"],
            file_format=file_format,
        )
        return Response({
            "id": saved_photo.pk,
            "url": private_photo_url(saved_photo.cloudinary_key, saved_photo.file_format),
        }, status=status.HTTP_201_CREATED)

    def delete(self, request, photo_id):
        student = get_student(request.user)
        photo = LogbookPhoto.objects.filter(pk=photo_id, entry__student=student).first()
        if not photo:
            return api_error("not_found", "Photo was not found.", status.HTTP_404_NOT_FOUND)
        if not StudentDayView.is_editable(photo.entry.week, photo.entry.entry_date):
            return api_error("week_locked", "This logbook date is read-only.", status.HTTP_423_LOCKED)

        try:
            from cloudinary.uploader import destroy

            destroy(photo.cloudinary_key, resource_type="image", type="authenticated")
        except Exception:
            return api_error(
                "photo_delete_failed",
                "The photo could not be removed. Try again later.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def get_coordinator_students(coordinator):
    """Return all students scoped to this coordinator.

    Includes students assigned via the new CohortDepartmentAssignment model
    as well as the legacy coordinator FK on StudentProfile.
    """
    from django.db.models import Q
    return StudentProfile.objects.filter(
        Q(coordinator=coordinator)
    ).distinct()


def reviewed_score_average(student):
    average = student.weeks.filter(status=WeeklySubmission.Status.REVIEWED).aggregate(
        average=Avg("entries__coordinator_review__rating")
    )["average"]
    return round(average, 2) if average is not None else None


class CoordinatorStudentListView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        coordinator = get_coordinator(request.user)
        students = get_coordinator_students(coordinator).select_related("user", "cohort", "supervisor")
        search = request.query_params.get("q", "").strip()
        if search:
            students = students.filter(Q(matric_no__icontains=search) | Q(user__email__icontains=search))
        requested_filter = request.query_params.get("filter")
        if requested_filter == "needs_review":
            students = students.filter(weeks__status=WeeklySubmission.Status.SUBMITTED).distinct()
        results = []
        for student in students.order_by("matric_no")[:100]:
            week_count = student.weeks.count()
            submitted = student.weeks.filter(status__in=["SUBMITTED", "REVIEWED", "RETURNED"]).count()
            pending_reviews = student.weeks.filter(status=WeeklySubmission.Status.SUBMITTED).count()
            pending_extensions = student.weeks.filter(extension_requests__status=ExtensionRequest.Status.PENDING).exists()
            results.append({
                "id": student.pk,
                "matricNo": student.matric_no,
                "name": f"{student.user.first_name} {student.user.last_name}".strip(),
                "email": student.user.email,
                "programme": student.programme,
                "supervisorName": (
                    student.supervisor.name
                    if student.programme == Programme.SIWES and hasattr(student, "supervisor")
                    else None
                ),
                "weeksSubmitted": submitted,
                "pendingReviewCount": pending_reviews,
                "runningScoreAvg": reviewed_score_average(student),
                "status": "needs_review" if pending_reviews else "extension_pending" if pending_extensions else "up_to_date",
                "totalWeeks": student.cohort.total_weeks if student.cohort else 0,
                "cohortId": student.cohort_id,
            })
        return Response({"results": results})


class CoordinatorDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        coordinator = get_coordinator(request.user)
        students = StudentProfile.objects.filter(coordinator=coordinator)
        today = timezone.localdate()
        now = timezone.now()
        sessions = AttendanceSession.objects.filter(
            created_by=coordinator,
            date=today,
        )
        submitted_weeks = WeeklySubmission.objects.filter(
            student__coordinator=coordinator,
            status=WeeklySubmission.Status.SUBMITTED,
        )
        weeks_to_review = WeeklySubmission.objects.filter(
            student__coordinator=coordinator,
            status__in=[WeeklySubmission.Status.SUBMITTED, WeeklySubmission.Status.RETURNED],
        )
        pending_extensions = ExtensionRequest.objects.filter(
            week__student__coordinator=coordinator,
            status=ExtensionRequest.Status.PENDING,
        ).count()
        attendance_records = AttendanceRecord.objects.filter(student__coordinator=coordinator)
        attendance_count = attendance_records.count()
        present_count = attendance_records.filter(
            status=AttendanceRecord.Status.PRESENT,
        ).count()

        cohorts = get_coordinator_cohorts(coordinator)
        cohort = (
            cohorts.filter(start_date__lte=today, end_date__gte=today).first()
            or cohorts.filter(start_date__gt=today).order_by("start_date").first()
            or cohorts.first()
        )
        if cohort and cohort.start_date <= today:
            days_from_start = (today - cohort.start_date).days
            week_number = min(
                cohort.total_weeks,
                max(1, (days_from_start + cohort.start_date.weekday()) // 7 + 1),
            )
            submission_deadline = week_deadline(cohort, week_number).strftime("%d %b %Y, %I:%M %p")
        else:
            week_number = 0
            submission_deadline = "Not set"

        recent_submissions = []
        for week in submitted_weeks.select_related("student__user", "cohort").order_by("-submitted_at")[:5]:
            week_start = cohort_week_start(week.cohort, week.week_no)
            week_end = min(week_start + timedelta(days=6), week.cohort.end_date)
            activities = [
                entry.activities.strip()
                for entry in week.entries.order_by("entry_date")
                if entry.activities.strip()
            ]
            recent_submissions.append({
                "id": str(week.pk),
                "studentName": account_name(week.student.user),
                "matricNo": week.student.matric_no,
                "weekNumber": week.week_no,
                "dates": f"{week_start:%d %b %Y} – {week_end:%d %b %Y}",
                "tasksSummary": " ".join(activities)[:300] or "Submitted logbook entries.",
                "status": "PENDING_REVIEW",
                "submittedAt": week.submitted_at.strftime("%d %b, %I:%M %p") if week.submitted_at else "",
            })

        return Response({
            "stats": {
                "enrolledStudents": students.count(),
                "pendingReviews": submitted_weeks.count(),
                "pendingExtensions": pending_extensions,
                "overdueWeeks": WeeklySubmission.objects.filter(
                    student__coordinator=coordinator,
                    status=WeeklySubmission.Status.OPEN,
                ).filter(
                    Q(extended_until__lt=now)
                    | Q(extended_until__isnull=True, deadline_at__lt=now)
                ).count(),
                "averageAttendance": round(present_count / attendance_count * 100) if attendance_count else 0,
            },
            "recentSubmissions": recent_submissions,
            "cohortInfo": {
                "programme": cohort.programme if cohort else coordinator.programme,
                "cycle": cohort.session if cohort else "No cohort created",
                "weekNumber": week_number,
                "totalWeeks": cohort.total_weeks if cohort else 0,
                "submissionDeadline": submission_deadline,
            },
            # Keep the existing count fields for API callers that use them.
            "student_count": students.count(),
            "submitted_weeks": submitted_weeks.count(),
            "weeks_to_review": weeks_to_review.count(),
            "attendance_today": {
                "sessions": sessions.count(),
                "present": AttendanceRecord.objects.filter(
                    session__in=sessions,
                    status=AttendanceRecord.Status.PRESENT,
                ).count(),
            },
        })


class CoordinatorStudentDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request, student_id):
        coordinator = get_coordinator(request.user)
        student = StudentProfile.objects.select_related("user", "cohort", "supervisor").filter(
            pk=student_id, coordinator=coordinator
        ).first()
        if not student:
            return api_error("not_found", "Student was not found.", status.HTTP_404_NOT_FOUND)
        weeks = []
        for week in student.weeks.order_by("week_no"):
            rating = week.entries.aggregate(average=Avg("coordinator_review__rating"))["average"]
            weeks.append({
                "id": week.pk,
                "weekNumber": week.week_no,
                "status": week_state(week).lower(),
                "averageRating": round(rating, 2) if rating is not None else None,
            })
        return Response({
            "id": student.pk,
            "runningScoreAvg": reviewed_score_average(student),
            "name": f"{student.user.first_name} {student.user.last_name}".strip(),
            "matricNo": student.matric_no,
            "programme": student.programme,
            "supervisor": (
                {
                    "name": student.supervisor.name,
                    "email": student.supervisor.email,
                    "phone": student.supervisor.phone,
                    "organisation": student.supervisor.organisation or None,
                }
                if student.programme == Programme.SIWES and hasattr(student, "supervisor")
                else None
            ),
            "weeks": weeks,
        })


class CoordinatorWeekView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def get(self, request, week_id):
        coordinator = get_coordinator(request.user)
        week = WeeklySubmission.objects.select_related("student__user", "cohort").filter(
            pk=week_id, student__coordinator=coordinator
        ).first()
        if not week:
            return api_error("not_found", "Week was not found.", status.HTTP_404_NOT_FOUND)
        if week.status not in ("SUBMITTED", "RETURNED", "REVIEWED"):
            return api_error("week_not_submitted", "This week is not ready for coordinator review.")

        entries = week.entries.select_related("coordinator_review").order_by("entry_date")
        entries_data = [
            {
                "id": entry.pk,
                "date": entry.entry_date.isoformat(),
                "dayName": entry.entry_date.strftime("%A"),
                "activities": entry.activities,
                "skills": entry.skills,
                "studentReview": entry.review_text,
                "rating": entry.coordinator_review.rating if hasattr(entry, "coordinator_review") else None,
                "comment": entry.coordinator_review.comment if hasattr(entry, "coordinator_review") else "",
                "photos": [
                    private_photo_url(photo.cloudinary_key, photo.file_format)
                    for photo in entry.photos.all()
                ],
            }
            for entry in entries
        ]
        return Response({
            "id": week.pk,
            "weekNumber": week.week_no,
            "status": week_state(week).lower(),
            "isLate": week.is_late,
            "studentName": f"{week.student.user.first_name} {week.student.user.last_name}".strip(),
            "matricNo": week.student.matric_no,
            "student": {
                "id": week.student_id,
                "name": f"{week.student.user.first_name} {week.student.user.last_name}".strip(),
                "matricNo": week.student.matric_no,
            },
            "entries": entries_data,
            "days": entries_data,
        })


class CoordinatorEntryReviewView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def put(self, request, entry_id):
        coordinator = get_coordinator(request.user)
        entry = LogbookEntry.objects.select_related("week", "student").filter(
            pk=entry_id,
            student__coordinator=coordinator,
            week__status__in=["SUBMITTED", "RETURNED"],
        ).first()
        if not entry:
            return api_error("not_found", "Entry was not found or cannot be reviewed.", status.HTTP_404_NOT_FOUND)
        if hasattr(entry.week, "supervisor_link") and entry.week.supervisor_link.review.status in ("SENT", "REVIEWED"):
            return api_error("week_in_supervisor_review", "This week is part of a supervisor review batch.")

        serializer = EntryReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review, _ = EntryReview.objects.update_or_create(
            entry=entry,
            defaults={
                "coordinator": coordinator,
                "rating": serializer.validated_data["rating"],
                "comment": serializer.validated_data.get("comment", ""),
            },
        )
        record_audit(request, "ENTRY_REVIEWED", review)
        return Response({"rating": review.rating, "comment": review.comment})


class CoordinatorFinishWeekView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request, week_id):
        coordinator = get_coordinator(request.user)
        week = WeeklySubmission.objects.filter(pk=week_id, student__coordinator=coordinator).first()
        if not week or week.status not in ("SUBMITTED", "RETURNED"):
            return api_error("not_found", "Submitted week was not found.", status.HTTP_404_NOT_FOUND)
        if hasattr(week, "supervisor_link") and week.supervisor_link.review.status in ("SENT", "REVIEWED"):
            return api_error("week_in_supervisor_review", "This week is part of a supervisor review batch.")
        if week.entries.exclude(coordinator_review__isnull=False).exists():
            return api_error("entries_not_rated", "Rate every written entry before finishing the week.")

        week.status = WeeklySubmission.Status.REVIEWED
        week.reviewed_at = timezone.now()
        week.entries.update(status=LogbookEntry.Status.REVIEWED)
        week.save(update_fields=["status", "reviewed_at"])
        record_audit(request, "WEEK_REVIEW_FINISHED", week)
        create_notification(
            week.student.user,
            InAppNotification.Trigger.WEEK_REVIEWED,
            f"Your logbook for week {week.week_no} has been reviewed.",
            link_to=f"/student/week/{week.week_no}",
            dedupe_key=f"week_reviewed:{week.pk}:{week.reviewed_at.isoformat()}",
        )
        return Response({"message": "Week review finished.", "status": "reviewed"})


class CoordinatorReturnWeekView(APIView):
    permission_classes = [IsAuthenticated, IsCoordinator]
    authentication_classes = [JWTAuthentication]

    def post(self, request, week_id):
        coordinator = get_coordinator(request.user)
        week = WeeklySubmission.objects.select_related("cohort").filter(
            pk=week_id,
            student__coordinator=coordinator,
            status__in=["SUBMITTED", "RETURNED"],
        ).first()
        if not week:
            return api_error("not_found", "Submitted week was not found.", status.HTTP_404_NOT_FOUND)
        if hasattr(week, "supervisor_link") and week.supervisor_link.review.status in ("SENT", "REVIEWED"):
            return api_error("week_in_supervisor_review", "This week is part of a supervisor review batch.")
        serializer = ReturnWeekSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        now = timezone.now()
        week.status = WeeklySubmission.Status.RETURNED
        week.returned_at = now
        week.correction_deadline = now + timedelta(days=week.cohort.correction_days)
        week.return_comment = serializer.validated_data["comment"]
        week.save(update_fields=["status", "returned_at", "correction_deadline", "return_comment"])
        week.entries.update(status=LogbookEntry.Status.RETURNED)
        record_audit(request, "WEEK_RETURNED", week, {"comment": serializer.validated_data["comment"]})
        create_notification(
            week.student.user,
            InAppNotification.Trigger.WEEK_RETURNED,
            f"Your logbook for week {week.week_no} was returned for corrections.",
            link_to=f"/student/week/{week.week_no}",
            dedupe_key=f"week_returned:{week.pk}:{week.returned_at.isoformat()}",
        )
        return Response({
            "message": "Week returned to the student.",
            "correctionDeadline": week.correction_deadline.isoformat(),
        })


# SIWES supervisor reviews. The supervisor uses a one-batch email token and
# does not need a Logr account.

def active_supervisor_token(request):
    raw_token = request.headers.get("X-Supervisor-Token", "").strip()
    if not raw_token:
        return None, api_error("token_invalid", "A supervisor review token is required.", status.HTTP_401_UNAUTHORIZED)

    token_hash = SupervisorReviewToken.hash_token(raw_token)
    token = SupervisorReviewToken.objects.select_related("review__student__user").filter(
        token_hash=token_hash,
        revoked_at__isnull=True,
    ).first()
    if not token:
        return None, api_error("token_invalid", "This supervisor review link is invalid.", status.HTTP_401_UNAUTHORIZED)
    if token.used_at:
        return None, api_error("already_submitted", "This supervisor review was already submitted.", status.HTTP_409_CONFLICT)
    if token.is_expired:
        if token.review.status == SupervisorReview.Status.SENT:
            token.review.status = SupervisorReview.Status.EXPIRED
            token.review.save(update_fields=["status"])
        return None, api_error("token_expired", "This supervisor review link has expired.", status.HTTP_401_UNAUTHORIZED)
    return token, None


class StudentSupervisorReviewView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        student = get_student(request.user)
        reviews = student.supervisor_reviews.prefetch_related("week_links__week").all()
        pending_weeks = student.weeks.filter(status__in=["SUBMITTED", "REVIEWED"]).exclude(
            pk__in=SupervisorReviewWeek.objects.values("week_id")
        ).order_by("week_no")

        batches = []
        for review in reviews:
            state = review.status
            token = review.tokens.filter(revoked_at__isnull=True).order_by("-created_at").first()
            if state == SupervisorReview.Status.SENT and token and token.is_expired:
                state = SupervisorReview.Status.EXPIRED
            batches.append({
                "id": review.pk,
                "batchNumber": review.batch_no,
                "weekNumbers": list(review.week_links.order_by("week__week_no").values_list("week__week_no", flat=True)),
                "sentAt": review.sent_at.isoformat(),
                "status": state.lower(),
                "supervisor": {
                    "name": review.name_snapshot,
                    "email": review.email_snapshot,
                    "phone": review.phone_snapshot,
                    "organisation": review.organisation_snapshot or None,
                },
                "reviewText": review.review_text or None,
                "signature": review.signed_name or supervisor_signature_url(review),
                "lastResendAt": review.last_resend_at.isoformat() if review.last_resend_at else None,
            })

        return Response({
            "unsentWeeks": [
                {"id": week.pk, "weekNumber": week.week_no, "status": week.status.lower()}
                for week in pending_weeks
            ],
            "batches": batches,
        })

    def post(self, request):
        student = get_student(request.user)
        if student.programme != Programme.SIWES:
            return api_error("not_applicable", "Supervisor reviews are only available for SIWES.", status.HTTP_403_FORBIDDEN)

        serializer = SupervisorDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        weeks = list(
            student.weeks.filter(status__in=["SUBMITTED", "REVIEWED"])
            .exclude(pk__in=SupervisorReviewWeek.objects.values("week_id"))
            .order_by("week_no")
        )
        if not weeks:
            return api_error("nothing_to_send", "There are no submitted weeks waiting for a supervisor review.")

        with transaction.atomic():
            supervisor, _ = SupervisorDetails.objects.update_or_create(
                student=student,
                defaults=serializer.validated_data,
            )
            batch_no = (student.supervisor_reviews.order_by("-batch_no").values_list("batch_no", flat=True).first() or 0) + 1
            review = SupervisorReview.objects.create(
                student=student,
                supervisor=supervisor,
                batch_no=batch_no,
                name_snapshot=supervisor.name,
                email_snapshot=supervisor.email,
                phone_snapshot=supervisor.phone,
                organisation_snapshot=supervisor.organisation,
            )
            SupervisorReviewWeek.objects.bulk_create([
                SupervisorReviewWeek(review=review, week=week) for week in weeks
            ])
            raw_token, hashed_token = SupervisorReviewToken.new_token()
            SupervisorReviewToken.objects.create(review=review, token_hash=hashed_token)
            record_audit(request, "SUPERVISOR_REVIEW_SENT", review, {"week_numbers": [week.week_no for week in weeks]})

        if student.coordinator:
            create_notification(
                student.coordinator.user,
                InAppNotification.Trigger.SUPERVISOR_DETAILS_RECEIVED,
                f"{account_name(student.user)} sent logbook weeks to supervisor {supervisor.name}.",
                link_to=f"/coordinator/students/{student.pk}",
                dedupe_key=f"supervisor_details_received:{review.pk}",
            )

        link = f"{settings.FRONTEND_URL}/supervisor/review?token={raw_token}"
        try:
            send_email(
                recipient=supervisor.email,
                subject="Logr supervisor review",
                body=f"Please review the submitted internship logbook here: {link}",
            )
            if student.coordinator:
                send_email(
                    recipient=student.coordinator.user.email,
                    subject="Supervisor review requested",
                    body=f"{account_name(student.user)} sent week(s) {[week.week_no for week in weeks]} to {supervisor.name}.",
                )
        except EmailDeliveryError:
            return api_error("email_delivery_failed", "The review batch was created, but an email could not be sent.", status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response({"id": review.pk, "status": review.status.lower(), "weekNumbers": [week.week_no for week in weeks]}, status=status.HTTP_201_CREATED)


class ResendSupervisorReviewView(APIView):
    permission_classes = [IsAuthenticated, IsStudent]
    authentication_classes = [JWTAuthentication]

    def post(self, request, review_id):
        student = get_student(request.user)
        review = SupervisorReview.objects.filter(pk=review_id, student=student).first()
        if not review or review.status not in (SupervisorReview.Status.SENT, SupervisorReview.Status.EXPIRED):
            return api_error("not_found", "An open supervisor review was not found.", status.HTTP_404_NOT_FOUND)
        if review.last_resend_at and timezone.now() < review.last_resend_at + timedelta(hours=24):
            return api_error("resend_too_soon", "A new link can be sent once every 24 hours.")

        for token in review.tokens.filter(revoked_at__isnull=True):
            token.revoked_at = timezone.now()
            token.save(update_fields=["revoked_at"])
        raw_token, hashed_token = SupervisorReviewToken.new_token()
        SupervisorReviewToken.objects.create(review=review, token_hash=hashed_token)
        review.status = SupervisorReview.Status.SENT
        review.last_resend_at = timezone.now()
        review.sent_at = timezone.now()
        review.save(update_fields=["status", "last_resend_at", "sent_at"])

        link = f"{settings.FRONTEND_URL}/supervisor/review?token={raw_token}"
        try:
            send_email(
                recipient=review.email_snapshot,
                subject="Your Logr supervisor review link",
                body=f"Use this new link to review the submitted logbook: {link}",
            )
        except EmailDeliveryError:
            return api_error("email_delivery_failed", "The new link was created, but the email could not be sent.", status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"message": "A new supervisor review link was sent."})


class SupervisorReviewView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        token, error_response = active_supervisor_token(request)
        if error_response:
            return error_response

        ip = request.META.get("REMOTE_ADDR", "unknown")
        throttle_key = f"supervisor-open:{token.token_hash}:{ip}"
        if not cache.add(throttle_key, 1, timeout=3600):
            count = cache.incr(throttle_key)
            if count > 30:
                return api_error("throttled", "Too many review link opens. Try again later.", status.HTTP_429_TOO_MANY_REQUESTS)

        token.last_opened_at = timezone.now()
        token.open_count += 1
        token.save(update_fields=["last_opened_at", "open_count"])
        review = token.review
        weeks = review.week_links.select_related("week").order_by("week__week_no")
        return Response({
            "student": {
                "name": f"{review.student.user.first_name} {review.student.user.last_name}".strip(),
                "matricNo": review.student.matric_no,
                "programme": review.student.programme,
                "organisation": review.organisation_snapshot or None,
            },
            "weeks": [
                {
                    "weekNumber": link.week.week_no,
                    "entries": [
                        {
                            "date": entry.entry_date.isoformat(),
                            "activities": entry.activities,
                            "skills": entry.skills,
                            "studentReview": entry.review_text,
                            "photos": [
                                private_photo_url(photo.cloudinary_key, photo.file_format)
                                for photo in entry.photos.all()
                            ],
                        }
                        for entry in link.week.entries.order_by("entry_date")
                    ],
                }
                for link in weeks
            ],
        })

    def post(self, request):
        token, error_response = active_supervisor_token(request)
        if error_response:
            return error_response
        serializer = SupervisorReviewSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        review = token.review
        review.review_text = data["review_text"]
        review.signature_type = data["signature_type"]
        review.signed_name = data.get("signed_name", "").strip()
        if data["signature_type"] == "DRAWN":
            try:
                import cloudinary
                from cloudinary.uploader import upload

                if not cloudinary.config().cloud_name:
                    raise RuntimeError("Cloudinary is not configured")
                image = upload(
                    data["signature_data"],
                    folder="logr/supervisor-signatures",
                    resource_type="image",
                    type="authenticated",
                    format="png",
                )
                review.signature_key = image["public_id"]
            except Exception:
                return api_error(
                    "signature_upload_failed",
                    "The signature could not be saved. Try again later.",
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        review.reviewed_at = timezone.now()
        review.reviewer_ip = request.META.get("REMOTE_ADDR")
        review.reviewer_agent = request.META.get("HTTP_USER_AGENT", "")[:300]
        review.status = SupervisorReview.Status.REVIEWED
        review.save(update_fields=[
            "review_text", "signature_type", "signature_key", "signed_name", "reviewed_at",
            "reviewer_ip", "reviewer_agent", "status",
        ])
        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])
        record_audit(request, "SUPERVISOR_REVIEW_SUBMITTED", review)
        create_notification(
            review.student.user,
            InAppNotification.Trigger.SUPERVISOR_REVIEW_SUBMITTED,
            f"Supervisor {review.name_snapshot} submitted a review of your logbook.",
            link_to="/student/reviews",
            dedupe_key=f"supervisor_review_submitted:student:{review.pk}",
        )
        if review.student.coordinator:
            create_notification(
                review.student.coordinator.user,
                InAppNotification.Trigger.SUPERVISOR_REVIEW_SUBMITTED,
                f"Supervisor review for {review.student.matric_no} has been submitted.",
                link_to=f"/coordinator/students/{review.student_id}",
                dedupe_key=f"supervisor_review_submitted:coordinator:{review.pk}",
            )

        try:
            send_email(
                recipient=review.student.user.email,
                subject="Supervisor review received",
                body=f"Your supervisor review from {review.name_snapshot} has been submitted.",
            )
            if review.student.coordinator:
                send_email(
                    recipient=review.student.coordinator.user.email,
                    subject="Supervisor review received",
                    body=f"The supervisor review for {review.student.matric_no} has been submitted.",
                )
            send_email(
                recipient=review.email_snapshot,
                subject="Thank you for your review",
                body="Your supervisor review was received successfully.",
            )
        except EmailDeliveryError:
            pass

        return Response({"message": "Supervisor review submitted."})


class SupervisorRequestNewLinkView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        token, error_response = active_supervisor_token(request)
        if error_response:
            return error_response
        review = token.review
        try:
            send_email(
                recipient=review.student.user.email,
                subject="Supervisor needs a new Logr review link",
                body=f"{review.name_snapshot} requested a new link for review batch {review.batch_no}.",
            )
        except EmailDeliveryError:
            return api_error("email_delivery_failed", "We could not notify the student.", status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"message": "The student was asked to send a new review link."})


# Admin endpoints

class AdminUserListView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        users = LogrAccount.objects.filter(is_superuser=False).order_by("email")
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        role = (request.query_params.get("role") or "").upper()
        account_status = request.query_params.get("status")
        faculty_id = request.query_params.get("faculty_id") or request.query_params.get("faculty")
        department_id = request.query_params.get("department_id") or request.query_params.get("department")

        if search:
            users = users.filter(
                Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(studentprofile__matric_no__icontains=search)
            )
        if role in ("STUDENT", "COORDINATOR"):
            users = users.filter(role=role)
        if account_status and account_status != "ALL":
            users = users.filter(status=account_status.upper())
        if faculty_id:
            users = users.filter(
                Q(studentprofile__department__faculty_id=faculty_id)
                | Q(coordinatorprofile__department__faculty_id=faculty_id)
            )
        if department_id:
            users = users.filter(
                Q(studentprofile__department_id=department_id)
                | Q(coordinatorprofile__department_id=department_id)
            )
        results = []
        for user in users:
            student = get_student(user)
            coordinator = get_coordinator(user)
            profile = student or coordinator
            dp = student.degree_programme if student else None
            dept = profile.department if profile else None
            fac = dept.faculty if dept else None

            # Student-specific stats
            weeks_submitted = 0
            weeks_reviewed = 0
            running_score_avg = None
            enrolled_students_count = None
            if student:
                weeks_submitted = student.weeks.filter(
                    status__in=[WeeklySubmission.Status.SUBMITTED, WeeklySubmission.Status.REVIEWED]
                ).count()
                weeks_reviewed = student.weeks.filter(status=WeeklySubmission.Status.REVIEWED).count()
                avg = student.weeks.filter(status=WeeklySubmission.Status.REVIEWED).aggregate(
                    avg=Avg("entries__coordinator_review__rating")
                )["avg"]
                running_score_avg = round(avg, 2) if avg is not None else None
            if coordinator:
                enrolled_students_count = StudentProfile.objects.filter(coordinator=coordinator).count()
            results.append({
                "id": user.pk,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "name": f"{user.first_name} {user.last_name}".strip(),
                "role": "STUDENT" if student else "COORDINATOR" if coordinator else user.role,
                "status": user.status,
                "is_active": user.is_active,
                "date_joined": user.last_login.isoformat()[:10] if user.last_login else None,
                "department_id": dept.id if dept else None,
                "department": dept.name if dept else None,
                "faculty_id": fac.id if fac else None,
                "faculty_name": fac.name if fac else None,
                "faculty_code": fac.code if fac else None,
                "degree_programme": dp.name if dp else None,
                "programme": profile.programme if profile else None,
                "level": profile.level if profile else None,
                "cohort_id": student.cohort_id if student else None,
                "coordinator_id": student.coordinator_id if student else None,
                "coordinator_name": (
                    f"{student.coordinator.user.first_name} {student.coordinator.user.last_name}".strip()
                    if student and student.coordinator else None
                ),
                # Student-specific
                "weeks_submitted": weeks_submitted if student else None,
                "weeks_reviewed": weeks_reviewed if student else None,
                "running_score_avg": running_score_avg if student else None,
                # Coordinator-specific
                "enrolled_students_count": enrolled_students_count if coordinator else None,
                # Profiles for frontend mapping
                "student_profile": {
                    "matric_no": student.matric_no,
                    "programme": student.programme,
                    "department_id": dept.id if dept else None,
                    "department_name": dept.name if dept else None,
                    "faculty_id": fac.id if fac else None,
                    "faculty_name": fac.name if fac else None,
                    "faculty_code": fac.code if fac else None,
                    "cohort_id": student.cohort_id,
                    "weeks_submitted": weeks_submitted,
                    "total_weeks": student.cohort.total_weeks if student.cohort else 0,
                    "running_score_avg": running_score_avg,
                } if student else None,
                "coordinator_profile": {
                    "id": coordinator.pk,
                    "department_id": dept.id if dept else None,
                    "department_name": dept.name if dept else None,
                    "faculty_id": fac.id if fac else None,
                    "faculty_name": fac.name if fac else None,
                    "faculty_code": fac.code if fac else None,
                    "programme": coordinator.programme, "level": coordinator.level,
                    "enrolled_students_count": enrolled_students_count,
                } if coordinator else None,
            })
        return Response({"results": results})


class AdminOverviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        from backend.auth.models import CoordinatorInvitation, Faculty
        today = timezone.localdate()
        local_now = timezone.localtime()
        week_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=local_now.weekday())
        submissions_this_week = WeeklySubmission.objects.filter(
            submitted_at__gte=week_start,
            submitted_at__lt=week_start + timedelta(days=7),
        ).count()

        # Submission stats
        total_weeks = WeeklySubmission.objects.count()
        submitted_weeks = WeeklySubmission.objects.filter(
            status__in=[WeeklySubmission.Status.SUBMITTED, WeeklySubmission.Status.REVIEWED]
        ).count()
        overdue_weeks = WeeklySubmission.objects.filter(
            status=WeeklySubmission.Status.OPEN,
            deadline_at__lt=timezone.now(),
        ).count()
        submission_rate = round((submitted_weeks / total_weeks) * 100) if total_weeks > 0 else 0

        # Faculty Breakdown
        faculties = Faculty.objects.prefetch_related("departments").all().order_by("name")
        faculty_breakdown = []
        for fac in faculties:
            depts_data = []
            fac_student_count = 0
            fac_coord_count = 0
            for d in fac.departments.all().order_by("name"):
                s_count = StudentProfile.objects.filter(department=d).count()
                c_count = CoordinatorProfile.objects.filter(department=d).count()
                fac_student_count += s_count
                fac_coord_count += c_count
                depts_data.append({
                    "id": d.id,
                    "name": d.name,
                    "students_count": s_count,
                    "coordinators_count": c_count,
                })
            faculty_breakdown.append({
                "id": fac.id,
                "name": fac.name,
                "code": fac.code,
                "students_count": fac_student_count,
                "coordinators_count": fac_coord_count,
                "departments_count": fac.departments.count(),
                "departments": depts_data,
            })

        return Response({
            "students": StudentProfile.objects.count(),
            "coordinators": CoordinatorProfile.objects.count(),
            "departments": Department.objects.count(),
            "active_accounts": LogrAccount.objects.filter(is_active=True, is_superuser=False).count(),
            "active_cohorts": Cohort.objects.filter(
                start_date__lte=today,
                end_date__gte=today,
            ).count(),
            "upcoming_cohorts": Cohort.objects.filter(start_date__gt=today).count(),
            "pending_students": StudentProfile.objects.filter(
                email_verified=True, cohort__isnull=True
            ).count(),
            "pending_invitations": CoordinatorInvitation.objects.filter(
                status="PENDING"
            ).count(),
            "weeks_waiting_for_review": WeeklySubmission.objects.filter(
                status=WeeklySubmission.Status.SUBMITTED,
            ).count(),
            "weeks_submitted_this_week": submissions_this_week,
            "supervisor_reviews_waiting": SupervisorReview.objects.filter(
                status=SupervisorReview.Status.SENT,
            ).count(),
            "overdue_weeks": overdue_weeks,
            "submission_rate": submission_rate,
            "cohort_completion_rate": submission_rate,
            "faculty_breakdown": faculty_breakdown,
        })


class AdminPendingStudentsView(APIView):
    """Students who are verified but not yet assigned to a cohort."""
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        students = (
            StudentProfile.objects
            .select_related("user", "department", "degree_programme")
            .filter(email_verified=True, cohort__isnull=True)
            .order_by("user__date_joined")
        )
        return Response({
            "count": students.count(),
            "results": [
                {
                    "id": s.pk,
                    "name": f"{s.user.first_name} {s.user.last_name}".strip(),
                    "email": s.user.email,
                    "matric_no": s.matric_no,
                    "department": s.department.name,
                    "degree_programme": s.degree_programme.name if s.degree_programme else None,
                    "programme": s.programme, "level": s.level,
                }
                for s in students
            ],
        })


class AdminStudentReassignView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def post(self, request, student_id):
        student = StudentProfile.objects.filter(pk=student_id).first()
        if not student:
            return api_error("not_found", "Student was not found.", status.HTTP_404_NOT_FOUND)

        coordinator = CoordinatorProfile.objects.filter(
            pk=request.data.get("coordinator_id"),
            department=student.department,
            programme=student.programme,
            level=student.level,
        ).first()
        if not coordinator:
            return api_error("coordinator_not_found", "Choose a coordinator for the student's department and programme.", status.HTTP_404_NOT_FOUND)

        student.coordinator = coordinator
        student.save(update_fields=["coordinator"])
        record_audit(request, "STUDENT_COORDINATOR_REASSIGNED", student, {
            "coordinator_id": coordinator.pk,
        })
        return Response({"student_id": student.pk, "coordinator_id": coordinator.pk})


class AdminCoordinatorReassignView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def post(self, request, coordinator_id):
        old_coordinator = CoordinatorProfile.objects.select_related("user").filter(
            pk=coordinator_id
        ).first()
        if not old_coordinator:
            return api_error("not_found", "Coordinator was not found.", status.HTTP_404_NOT_FOUND)

        new_coordinator = CoordinatorProfile.objects.select_related("user").filter(
            pk=request.data.get("new_coordinator_id"),
            department=old_coordinator.department,
            programme=old_coordinator.programme,
            level=old_coordinator.level,
        ).first()
        if not new_coordinator or new_coordinator.pk == old_coordinator.pk:
            return api_error(
                "coordinator_not_found",
                "Choose another coordinator for the same department and programme.",
                status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            moved_count = StudentProfile.objects.filter(coordinator=old_coordinator).update(
                coordinator=new_coordinator
            )
            Cohort.objects.filter(
                coordinator=old_coordinator,
                end_date__gte=timezone.localdate(),
            ).update(coordinator=new_coordinator)
            CohortDepartmentAssignment.objects.filter(
                coordinator=old_coordinator,
                cohort__end_date__gte=timezone.localdate(),
            ).update(coordinator=new_coordinator)
            old_coordinator.user.status = LogrAccount.Status.DEACTIVATED
            old_coordinator.user.status_reason = "Coordinator reassigned"
            old_coordinator.user.is_active = False
            old_coordinator.user.save(update_fields=["status", "status_reason", "is_active"])
            for token in OutstandingToken.objects.filter(user=old_coordinator.user):
                BlacklistedToken.objects.get_or_create(token=token)
            record_audit(request, "COORDINATOR_REASSIGNED", old_coordinator, {
                "new_coordinator_id": new_coordinator.pk,
                "students_moved": moved_count,
            })

        return Response({
            "coordinator_id": old_coordinator.pk,
            "new_coordinator_id": new_coordinator.pk,
            "students_moved": moved_count,
            "status": old_coordinator.user.status,
        })


class AdminUserStatusView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def patch(self, request, user_id):
        user = LogrAccount.objects.filter(pk=user_id, is_superuser=False).first()
        if not user:
            return api_error("not_found", "Account was not found.", status.HTTP_404_NOT_FOUND)

        serializer = AccountStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.status = serializer.validated_data["status"]
        user.status_reason = serializer.validated_data["reason"]
        user.status_note = serializer.validated_data["note"]
        user.is_active = False
        user.save(update_fields=["status", "status_reason", "status_note", "is_active"])
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
        record_audit(request, "ACCOUNT_STATUS_CHANGED", user, serializer.validated_data)
        return Response({"id": user.pk, "status": user.status, "is_active": user.is_active})

    def post(self, request, user_id):
        user = LogrAccount.objects.filter(pk=user_id, is_superuser=False).first()
        if not user:
            return api_error("not_found", "Account was not found.", status.HTTP_404_NOT_FOUND)
        user.status = LogrAccount.Status.ACTIVE
        user.status_reason = ""
        user.status_note = ""
        user.is_active = True
        user.save(update_fields=["status", "status_reason", "status_note", "is_active"])
        record_audit(request, "ACCOUNT_REACTIVATED", user)
        return Response({"id": user.pk, "status": user.status, "is_active": user.is_active})


class AdminUserDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def delete(self, request, user_id):
        user = LogrAccount.objects.filter(pk=user_id, is_superuser=False).first()
        if not user:
            return api_error("not_found", "Account was not found.", status.HTTP_404_NOT_FOUND)
        if request.data.get("confirm_email", "").strip().lower() != user.email.lower():
            return api_error("delete_confirmation_required", "Send the account email in confirm_email to delete it.")

        try:
            with transaction.atomic():
                record_audit(request, "ACCOUNT_DELETED", user, {"email": user.email})
                user.delete()
        except ProtectedError:
            return api_error("account_in_use", "Reassign or remove dependent records before deleting this account.", status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminStudentAssignmentView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def patch(self, request, student_id):
        student = StudentProfile.objects.select_related("cohort").filter(pk=student_id).first()
        if not student:
            return api_error("not_found", "Student was not found.", status.HTTP_404_NOT_FOUND)

        cohort_id = request.data.get("cohort_id")
        coordinator_id = request.data.get("coordinator_id")
        cohort = Cohort.objects.filter(pk=cohort_id).first() if cohort_id else student.cohort
        coordinator = CoordinatorProfile.objects.filter(pk=coordinator_id).first() if coordinator_id else None
        if cohort_id and not cohort:
            return api_error("cohort_not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)
        if coordinator_id and not coordinator:
            return api_error("coordinator_not_found", "Coordinator was not found.", status.HTTP_404_NOT_FOUND)
        if cohort:
            if cohort.programme != student.programme or cohort.level != student.level:
                return api_error("assignment_mismatch", "Student programme must match the cohort programme.")
            dept_in_cohort = (
                cohort.department_assignments.filter(department=student.department).exists()
                or cohort.department_id == student.department_id
            )
            if not dept_in_cohort:
                return api_error("assignment_mismatch", "Student's department is not included in this cohort.")

        if coordinator:
            if coordinator.programme != student.programme or coordinator.level != student.level:
                return api_error("assignment_mismatch", "Coordinator programme must match the student programme.")

        # Determine coordinator: explicitly given > department coordinator in cohort > legacy cohort coordinator
        final_coordinator = coordinator
        if not final_coordinator and cohort:
            dept_assign = cohort.department_assignments.filter(department=student.department).first()
            if dept_assign and dept_assign.coordinator:
                final_coordinator = dept_assign.coordinator
            elif cohort.coordinator:
                final_coordinator = cohort.coordinator

        student.cohort = cohort
        student.coordinator = final_coordinator
        student.save(update_fields=["cohort", "coordinator"])
        record_audit(request, "STUDENT_ASSIGNMENT_CHANGED", student, {
            "cohort_id": student.cohort_id,
            "coordinator_id": student.coordinator_id,
        })
        return Response({"student_id": student.pk, "cohort_id": student.cohort_id, "coordinator_id": student.coordinator_id})


class AdminStudentProgrammeView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def patch(self, request, student_id):
        student = StudentProfile.objects.filter(pk=student_id).first()
        if not student:
            return api_error("not_found", "Student was not found.", status.HTTP_404_NOT_FOUND)
        serializer = ProgrammeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if LogbookEntry.objects.filter(student=student).exists():
            return api_error("programme_locked", "Programme cannot change after logbook entries exist.")

        student.programme = serializer.validated_data["programme"]
        student.level = serializer.validated_data["level"]
        # Look up active cohort for this student's department in the new programme
        assignment = CohortDepartmentAssignment.objects.select_related("cohort", "coordinator").filter(
            department=student.department,
            cohort__programme=student.programme,
            cohort__level=student.level,
            cohort__end_date__gte=timezone.localdate(),
        ).order_by("cohort__start_date").first()
        if assignment:
            student.cohort = assignment.cohort
            student.coordinator = assignment.coordinator
        else:
            legacy_cohort = Cohort.objects.filter(
                department=student.department,
                programme=student.programme,
                level=student.level,
                end_date__gte=timezone.localdate(),
            ).order_by("start_date").first()
            student.cohort = legacy_cohort
            student.coordinator = legacy_cohort.coordinator if legacy_cohort else None

        student.save(update_fields=["programme", "level", "cohort", "coordinator"])
        record_audit(request, "STUDENT_PROGRAMME_CHANGED", student, {"programme": student.programme})
        return Response({"student_id": student.pk, "programme": student.programme, "cohort_id": student.cohort_id})


class AdminReportView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        cohort_id = request.query_params.get("cohort_id")
        cohort = Cohort.objects.filter(pk=cohort_id).first() if cohort_id else None
        if cohort_id and not cohort:
            return api_error("cohort_not_found", "Cohort was not found.", status.HTTP_404_NOT_FOUND)

        if request.query_params.get("format") == "csv":
            students = StudentProfile.objects.select_related("user", "department", "cohort")
            if cohort:
                students = students.filter(cohort=cohort)
            response = HttpResponse(content_type="text/csv")
            response["Content-Disposition"] = 'attachment; filename="logr-report.csv"'
            writer = csv.writer(response)
            writer.writerow(["email", "matric_no", "department", "programme", "cohort", "attendance_present", "weeks_submitted", "weeks_reviewed"])
            for student in students:
                writer.writerow([
                    student.user.email,
                    student.matric_no,
                    student.department.name,
                    student.programme,
                    student.cohort.session if student.cohort else "",
                    student.attendance_records.filter(status=AttendanceRecord.Status.PRESENT).count(),
                    student.weeks.filter(status__in=[WeeklySubmission.Status.SUBMITTED, WeeklySubmission.Status.REVIEWED]).count(),
                    student.weeks.filter(status=WeeklySubmission.Status.REVIEWED).count(),
                ])
            return response

        # Per-department/programme breakdown across all active cohorts
        cohorts_qs = Cohort.objects.select_related("department").order_by("department__name", "programme")
        if cohort:
            cohorts_qs = cohorts_qs.filter(pk=cohort.pk)

        results = []
        for c in cohorts_qs:
            dept_students = StudentProfile.objects.filter(cohort=c)
            total = dept_students.count()
            total_weeks_possible = WeeklySubmission.objects.filter(cohort=c).count()
            submitted = WeeklySubmission.objects.filter(
                cohort=c,
                status__in=[WeeklySubmission.Status.SUBMITTED, WeeklySubmission.Status.REVIEWED],
            ).count()
            missed = WeeklySubmission.objects.filter(
                cohort=c,
                status=WeeklySubmission.Status.OPEN,
                deadline_at__lt=timezone.now(),
            ).count()
            approved_ext = ExtensionRequest.objects.filter(
                week__cohort=c,
                status=ExtensionRequest.Status.APPROVED,
            ).count()
            avg_score = EntryReview.objects.filter(
                entry__week__cohort=c
            ).aggregate(avg=Avg("rating"))["avg"]
            attendance_present = AttendanceRecord.objects.filter(
                student__in=dept_students,
                status=AttendanceRecord.Status.PRESENT,
            ).count()
            total_attendance = AttendanceRecord.objects.filter(
                student__in=dept_students,
            ).count()
            submission_rate = round((submitted / total_weeks_possible) * 100) if total_weeks_possible > 0 else 0
            avg_attendance = round((attendance_present / total_attendance) * 100) if total_attendance > 0 else None

            results.append({
                "id": c.pk,
                "department": c.department.name,
                "programme": c.programme,
                "session": c.session,
                "enrolled_students": total,
                "submission_rate": submission_rate,
                "missed_weeks": missed,
                "approved_extensions": approved_ext,
                "average_score": round(avg_score * 20) if avg_score is not None else 0,  # Convert 1-5 to 0-100
                "average_attendance": avg_attendance,
            })

        return Response(results)


class AdminSupervisorReviewVoidView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def post(self, request, review_id):
        review = SupervisorReview.objects.filter(pk=review_id).first()
        if not review:
            return api_error("not_found", "Supervisor review batch was not found.", status.HTTP_404_NOT_FOUND)
        if review.status == SupervisorReview.Status.REVIEWED:
            return api_error("already_reviewed", "A submitted supervisor review cannot be voided.", status.HTTP_409_CONFLICT)
        review.status = SupervisorReview.Status.VOID
        review.save(update_fields=["status"])
        review.tokens.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        record_audit(request, "SUPERVISOR_REVIEW_VOIDED", review)
        return Response({"id": review.pk, "status": review.status.lower()})


class AdminAuditLogView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        logs = AuditLog.objects.select_related("actor").all()
        actor = request.query_params.get("actor", "").strip()
        action = request.query_params.get("action", "").strip()
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if actor:
            logs = logs.filter(actor__email__icontains=actor)
        if action:
            logs = logs.filter(action=action)
        try:
            if date_from:
                logs = logs.filter(created_at__date__gte=datetime.strptime(date_from, "%Y-%m-%d").date())
            if date_to:
                logs = logs.filter(created_at__date__lte=datetime.strptime(date_to, "%Y-%m-%d").date())
        except ValueError:
            return api_error("invalid_date", "Use YYYY-MM-DD for audit date filters.")

        logs = logs[:200]
        return Response({"results": [
            {"id": item.pk, "actor": item.actor.email if item.actor else None,
             "action": item.action, "target_type": item.target_type,
             "target_id": item.target_id, "details": item.details,
             "created_at": item.created_at.isoformat()}
            for item in logs
        ]})



