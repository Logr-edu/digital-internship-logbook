import type { ApiResult } from "@/types/api";

// Local requests use the Next.js development proxy to avoid browser CORS.
const API_ORIGIN = process.env.NODE_ENV === "development"
  ? ""
  : (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const BASE = API_ORIGIN + "/api/v1";

// ── Token storage & keys ───────────────────────────────────
const ACCESS_KEY  = "logr_access";
const REFRESH_KEY = "logr_refresh";
const ROLE_KEY    = "logr_role";

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function decodeJwt(token: string): { exp?: number; role?: string; user_role?: string; user_id?: number } | null {
  try {
    const seg = token.split(".")[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/").padEnd(seg.length + ((4 - (seg.length % 4)) % 4), "=");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/** Schedule a proactive token refresh 60s before the access token expires. */
function scheduleRefreshTimer(accessToken: string) {
  if (typeof window === "undefined") return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const payload = decodeJwt(accessToken);
  if (!payload?.exp) return;

  const msUntilExpiry = payload.exp * 1000 - Date.now();
  // Refresh 60 seconds before expiration, with a minimum 10s delay
  const refreshDelay = Math.max(10_000, msUntilExpiry - 60_000);

  refreshTimer = setTimeout(() => {
    performTokenRefresh();
  }, refreshDelay);
}

/** Proactively or reactively refresh the JWT tokens via /auth/refresh/. */
export async function performTokenRefresh(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const refresh = tokenStore.getRefresh();
  if (!refresh) return false;

  // Deduplicate concurrent refresh requests into a single promise
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.access && data.refresh) {
          tokenStore.set(data.access, data.refresh, data.role);
          return true;
        }
      }

      // If refresh failed with 401 or 400 (session revoked / expired)
      if (res.status === 401 || res.status === 400) {
        tokenStore.clear();
        const path = window.location.pathname;
        if (
          path.startsWith("/student") ||
          path.startsWith("/coordinator") ||
          path.startsWith("/admin")
        ) {
          const loginPath = path.startsWith("/admin") ? "/admin/login" : "/login";
          window.location.href = `${loginPath}?next=${encodeURIComponent(path)}`;
        }
      }

      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const tokenStore = {
  getAccess:  () => (typeof window !== "undefined" ? localStorage.getItem(ACCESS_KEY)  : null),
  getRefresh: () => (typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null),
  getRole:    () => (typeof window !== "undefined" ? localStorage.getItem(ROLE_KEY)    : null),
  set:        (access: string, refresh: string, explicitRole?: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(ACCESS_KEY,  access);
      localStorage.setItem(REFRESH_KEY, refresh);

      const payload = decodeJwt(access);
      const role = (explicitRole ?? payload?.role ?? payload?.user_role)?.toLowerCase() || "";
      if (role) {
        localStorage.setItem(ROLE_KEY, role);
      }

      // Synchronize with cookies for Next.js SSR middleware (7 days session)
      document.cookie = `logr_session=${access}; path=/; max-age=604800; SameSite=Lax`;
      if (role) {
        document.cookie = `logr_role=${role}; path=/; max-age=604800; SameSite=Lax`;
      }

      // Schedule next proactive refresh
      scheduleRefreshTimer(access);
    }
  },
  clear: () => {
    if (typeof window !== "undefined") {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem("logr_user_profile");
      document.cookie = "logr_session=; path=/; max-age=0; SameSite=Lax";
      document.cookie = "logr_role=; path=/; max-age=0; SameSite=Lax";
    }
  },
};

// Auto-initialize proactive timer or trigger immediate refresh on client boot
if (typeof window !== "undefined") {
  const existingAccess = localStorage.getItem(ACCESS_KEY);
  const existingRefresh = localStorage.getItem(REFRESH_KEY);
  if (existingAccess) {
    const payload = decodeJwt(existingAccess);
    if (payload?.exp && payload.exp * 1000 - Date.now() < 30_000 && existingRefresh) {
      // Access token is already expired or expiring in < 30 seconds
      performTokenRefresh();
    } else {
      scheduleRefreshTimer(existingAccess);
    }
  }
}

// ── Core fetch wrapper ────────────────────────────────────
interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip attaching the Bearer token (e.g. public endpoints). */
  public?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { body, headers, public: isPublic, ...rest } = options;
  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
  const contentHeaders: Record<string, string> = isMultipart ? {} : { "Content-Type": "application/json" };
  const requestBody = isMultipart ? body : body != null ? JSON.stringify(body) : undefined;

  const authHeader: Record<string, string> = {};
  if (!isPublic) {
    const token = tokenStore.getAccess();
    if (token) authHeader["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: { ...contentHeaders, ...authHeader, ...headers },
      body: requestBody,
    });

    if (res.status === 204) return { ok: true, data: undefined as T };

    // ── 401 Interceptor: Proactive token refresh & retry ───
    if (
      res.status === 401 &&
      !isPublic &&
      path !== "/auth/refresh/" &&
      path !== "/auth/login/" &&
      path !== "/auth/admin/login/"
    ) {
      const refreshed = await performTokenRefresh();
      if (refreshed) {
        const newToken = tokenStore.getAccess();
        const retryRes = await fetch(`${BASE}${path}`, {
          ...rest,
          headers: {
            ...contentHeaders,
            ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
            ...headers,
          },
          body: requestBody,
        });

        if (retryRes.status === 204) return { ok: true, data: undefined as T };
        const retryJson = await retryRes.json().catch(() => ({}));

        if (!retryRes.ok) {
          return {
            ok: false,
            status: retryRes.status,
            code: retryJson?.code,
            message: retryJson?.message ?? retryJson?.error ?? retryJson?.detail ?? "Something went wrong.",
            errors: isFieldErrors(retryJson) ? retryJson : undefined,
          };
        }

        return { ok: true, data: retryJson as T };
      }
    }

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: json?.code,
        message: json?.message ?? json?.error ?? json?.detail ?? "Something went wrong.",
        errors: isFieldErrors(json) ? json : undefined,
      };
    }

    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Check your connection." };
  }
}

/** Guard: DRF field-error objects have string-array values, not strings. */
function isFieldErrors(obj: unknown): obj is Record<string, string[]> {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some((v) => Array.isArray(v));
}

export const api = {
  get:    <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>(path, { method: "GET", ...opts }),
  post:   <T>(path: string, body: unknown, opts?: Omit<RequestOptions, "body">) => request<T>(path, { method: "POST", body, ...opts }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  put:    <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};


