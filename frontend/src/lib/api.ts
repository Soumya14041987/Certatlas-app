/**
 * Thin API client.
 *
 * Access tokens are short-lived and held in memory; the refresh token is the
 * only thing that touches storage, and a 401 triggers exactly one refresh
 * attempt which every concurrent caller shares.
 */
import type {
  AdminQuestion, AdminQuestionList, Analytics, Attempt, AttemptSummary, Blueprint,
  CheatSheetPayload, Curriculum, Heuristics, ReviewItem, Scorecard, SetSummary, UpdatesFeed, User,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const PREFIX = `${BASE}/api/v1`;
const REFRESH_KEY = "ccarf.refresh";

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const oauthStartUrl = (provider: "google" | "github") => `${PREFIX}/auth/oauth/${provider}/start`;

export const auth = {
  get access() { return accessToken; },
  get refresh() {
    try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
  },
  set(access: string, refresh: string) {
    accessToken = access;
    try { localStorage.setItem(REFRESH_KEY, refresh); } catch { /* private mode */ }
    listeners.forEach((fn) => fn());
  },
  clear() {
    accessToken = null;
    try { localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
    listeners.forEach((fn) => fn());
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function detailOf(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload) return payload;
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
      if (first?.msg) {
        const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null;
        return field ? `${field}: ${first.msg}` : first.msg;
      }
    }
  }
  return fallback;
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${PREFIX}${path}`, { ...init, headers });
}

async function tryRefresh(): Promise<boolean> {
  const token = auth.refresh;
  if (!token) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${PREFIX}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });
        if (!response.ok) { auth.clear(); return false; }
        const data = await response.json();
        auth.set(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let response: Response;
  try {
    response = await raw(path, init);
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the API running?");
  }

  if (response.status === 401 && retry && auth.refresh) {
    if (await tryRefresh()) return request<T>(path, init, false);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

  if (!response.ok) throw new ApiError(response.status, detailOf(payload, response.statusText));
  return payload as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  // --- auth ---------------------------------------------------------------
  register: (email: string, full_name: string, password: string) =>
    post<{ access_token: string; refresh_token: string }>("/auth/register", { email, full_name, password }),
  login: (email: string, password: string) =>
    post<{ access_token: string; refresh_token: string }>("/auth/login", { email, password }),
  logout: () => {
    const token = auth.refresh;
    const done = token ? post<void>("/auth/logout", { refresh_token: token }).catch(() => undefined) : Promise.resolve();
    auth.clear();
    return done;
  },
  me: () => get<User>("/auth/me"),
  updateProfile: (body: { full_name?: string; target_exam_date?: string | null }) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(body) }),
  sessions: () => get<{ id: number; issued_at: string; expires_at: string; active: boolean; user_agent: string | null }[]>("/auth/sessions"),
  logoutEverywhere: () => post<void>("/auth/logout-all"),

  // --- catalogue ----------------------------------------------------------
  blueprint: () => get<Blueprint>("/blueprint"),
  courses: () => get<Curriculum>("/courses"),
  cheatsheets: () => get<Pick<CheatSheetPayload, "slug" | "domain" | "title" | "summary" | "anchors">[]>("/cheatsheets"),
  heuristics: () => get<Heuristics>("/heuristics"),
  cheatsheet: (slug: string, anchor?: string) =>
    get<CheatSheetPayload>(`/cheatsheets/${slug}${anchor ? `?anchor=${encodeURIComponent(anchor)}` : ""}`),

  // --- practice + exam ----------------------------------------------------
  sets: (page = 1, perPage = 30) => get<{ page: number; pages: number; per_page: number; total: number; sets: SetSummary[] }>(
    `/practice/sets?page=${page}&per_page=${perPage}`),
  startPractice: (set_number: number, resume_existing = true) =>
    post<Attempt>("/practice/start", { set_number, resume_existing }),
  startExam: () => post<Attempt>("/exam/start", { acknowledge_timed: true }),
  startDiagnostic: () => post<Attempt>("/diagnostic/start", {}),
  startFocus: () => post<Attempt>("/focus/start", {}),

  attempts: (params: { mode?: string; status?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.mode) query.set("mode", params.mode);
    if (params.status) query.set("status", params.status);
    query.set("limit", String(params.limit ?? 25));
    return get<AttemptSummary[]>(`/attempts?${query}`);
  },
  attempt: (id: number) => get<Attempt>(`/attempts/${id}`),
  answer: (id: number, body: { question_id: string; selected: string[]; flagged?: boolean; seconds_spent?: number }) =>
    post<{ saved: boolean }>(`/attempts/${id}/answer`, body),
  cursor: (id: number, position: number) => post<{ cursor: number }>(`/attempts/${id}/cursor?position=${position}`),
  pause: (id: number) => post<AttemptSummary>(`/attempts/${id}/pause`),
  resume: (id: number) => post<Attempt>(`/attempts/${id}/resume`),
  submit: (id: number) => post<Scorecard>(`/attempts/${id}/submit`),
  abandon: (id: number) => request<void>(`/attempts/${id}`, { method: "DELETE" }),
  scorecard: (id: number) => get<Scorecard>(`/attempts/${id}/scorecard`),
  review: (id: number, onlyIncorrect = false) =>
    get<{ attempt_id: number; label: string; pass_mark: number; count: number; items: ReviewItem[] }>(
      `/attempts/${id}/review?only_incorrect=${onlyIncorrect}`),

  // --- updates --------------------------------------------------------------
  updates: () => get<UpdatesFeed>("/updates/videos"),

  // --- analytics + admin --------------------------------------------------
  analytics: () => get<Analytics>("/analytics/overview"),
  adminStats: () => get<Record<string, unknown>>("/admin/stats"),
  adminUsers: () => get<User[]>("/admin/users"),
  adminUpdateUser: (id: number, body: { is_active?: boolean; role?: string }) =>
    request<User>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  adminQuestionTemplate: () => get<{ template: Record<string, unknown> }>("/admin/content/questions/template"),
  adminListQuestions: (params: { domain?: string; search?: string; page?: number; per_page?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.domain) query.set("domain", params.domain);
    if (params.search) query.set("search", params.search);
    query.set("page", String(params.page ?? 1));
    query.set("per_page", String(params.per_page ?? 25));
    return get<AdminQuestionList>(`/admin/content/questions?${query}`);
  },
  adminGetQuestion: (id: string) => get<AdminQuestion>(`/admin/content/questions/${id}`),
  adminImportQuestions: (name: string, questions: Record<string, unknown>[]) =>
    post<{ imported: number; file: string }>("/admin/content/questions", { name, questions }),
  adminUpdateQuestion: (id: string, body: Record<string, unknown>) =>
    request<{ updated: string; file: string }>(`/admin/content/questions/${id}`, {
      method: "PUT", body: JSON.stringify(body),
    }),
  adminDeleteQuestion: (id: string) =>
    request<void>(`/admin/content/questions/${id}`, { method: "DELETE" }),
  adminRefreshUpdates: () => post<UpdatesFeed>("/admin/updates/refresh"),
  adminMarkReviewed: (verified_by: string, version?: string) =>
    post<{ last_verified: string; verified_by: string; version: string }>(
      "/admin/content/mark-reviewed", { verified_by, version }),
};
