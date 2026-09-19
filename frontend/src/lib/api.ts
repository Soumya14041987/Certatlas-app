/**
 * Thin API client.
 *
 * Identity, credentials and session storage/refresh are Supabase Auth's job
 * now (see lib/supabaseClient.ts, lib/auth.tsx) — this client's only auth
 * responsibility is attaching whatever access token Supabase currently
 * holds to each request.
 */
import { supabase } from "./supabaseClient";
import type {
  AdminQuestion, AdminQuestionList, Analytics, Attempt, AttemptSummary, Blueprint,
  CheatSheetPayload, Curriculum, DrillSummary, Heuristics, ReviewItem, Scorecard, SetSummary, UpdatesFeed, User,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const PREFIX = `${BASE}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

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
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(`${PREFIX}${path}`, { ...init, headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await raw(path, init);
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the API running?");
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
  // --- profile --------------------------------------------------------------
  me: () => get<User>("/auth/me"),
  updateProfile: (body: { full_name?: string; target_exam_date?: string | null }) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(body) }),

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
  startExam: (quick = false) => post<Attempt>("/exam/start", { acknowledge_timed: true, quick }),
  drillSummary: () => get<DrillSummary>("/drill/summary"),
  startDrill: () => post<Attempt>("/drill/start", {}),
  startDiagnostic: () => post<Attempt>("/diagnostic/start", {}),
  startFocus: () => post<Attempt>("/focus/start", {}),
  startWeakArea: () => post<Attempt>("/weakarea/start", {}),

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
  adminUpdateUser: (id: string, body: { is_active?: boolean; role?: string }) =>
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
