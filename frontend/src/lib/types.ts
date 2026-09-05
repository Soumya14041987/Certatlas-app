export type Role = "user" | "admin";
export type Mode = "practice" | "exam";
export type AttemptStatus = "in_progress" | "paused" | "submitted" | "abandoned";
export type Difficulty = "foundational" | "applied" | "architect";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  target_exam_date: string | null;
}

export interface Option { key: string; text: string }

export interface Question {
  id: string;
  domain: string;
  difficulty: Difficulty;
  type: "single" | "multi";
  select_count: number;
  stem: string;
  options: Option[];
  tags: string[];
  position?: number;
}

export interface Snippet { lang: string; title: string; code: string }
export interface Analogy { frame: string; text: string }

export interface CheatSheetPayload {
  slug: string;
  domain: string;
  title: string;
  summary: string;
  body: string;
  anchors: string[];
  anchor?: string;
  section?: string | null;
}

export interface ReviewItem extends Question {
  position: number;
  selected: string[];
  is_correct: boolean;
  answered: boolean;
  flagged: boolean;
  seconds_spent: number;
  objective: string;
  correct: string[];
  explanation: string;
  distractor_notes: Record<string, string>;
  analogy: Analogy | null;
  snippet: Snippet | null;
  diagram: string | null;
  cheatsheet: string;
  sources: string[];
  cheatsheet_content?: CheatSheetPayload | null;
}

export interface AttemptSummary {
  id: number;
  mode: Mode;
  status: AttemptStatus;
  set_number: number | null;
  label: string;
  total_questions: number;
  answered: number;
  cursor: number;
  elapsed_seconds: number;
  remaining_seconds: number | null;
  started_at: string;
  submitted_at: string | null;
  score_percent: number | null;
  passed: boolean | null;
  can_pause: boolean;
}

export interface Attempt extends AttemptSummary {
  questions: Question[];
  answers: Record<string, { selected: string[]; flagged: boolean; seconds_spent: number }>;
}

export interface DomainResult {
  correct: number;
  total: number;
  unanswered: number;
  name: string;
  percent: number;
}

export interface Scorecard {
  attempt_id: number;
  mode: Mode;
  set_number: number | null;
  label: string;
  score_percent: number;
  correct: number;
  total: number;
  passed: boolean;
  pass_mark: number;
  elapsed_seconds: number;
  seconds_per_question: number;
  submitted_at: string | null;
  domain_breakdown: Record<string, DomainResult>;
  focus_areas: { code: string; name: string; percent: number }[];
}

export interface SetSummary {
  set_number: number;
  size: number;
  difficulty: Record<Difficulty, number>;
  domains: Record<string, number>;
  intensity: "steady" | "moderate" | "high";
}

export interface BlueprintDomain {
  code: string;
  name: string;
  weight_percent: number;
  exam_questions: number;
  cheatsheet: string;
  objectives: string[];
}

export interface Blueprint {
  exam_code: string;
  exam_name: string;
  version: string;
  provenance: string;
  question_count: number;
  duration_minutes: number;
  pass_percent: number;
  scoring: string;
  domains: BlueprintDomain[];
  practice_sets: number;
  practice_set_size: number;
  bank: {
    total_questions: number;
    cheatsheets: number;
    courses: number;
    domains: { code: string; name: string; count: number; difficulty: Record<string, number> }[];
  };
}

export interface Course {
  id: string;
  title: string;
  provider: string;
  format: string;
  est_hours: number;
  link_kind: "direct" | "catalog";
  url: string;
  domains: string[];
  why: string;
}

export interface Curriculum {
  note: string;
  catalogs: { name: string; url: string }[];
  courses: Course[];
  study_plan: { week: number; focus: string; courses: string[]; target: string }[];
}

export interface Analytics {
  attempts_submitted: number;
  practice_submitted: number;
  exams_submitted: number;
  questions_answered: number;
  best_score: number | null;
  latest_score: number | null;
  average_recent: number | null;
  projected_score: number | null;
  pass_mark: number;
  readiness: "not_started" | "not_ready" | "borderline" | "ready";
  days_until_exam: number | null;
  domains: {
    code: string; name: string; weight_percent: number;
    correct: number; total: number; percent: number | null;
  }[];
  focus_areas: { code: string; name: string; percent: number | null }[];
  trend: { attempt_id: number; mode: Mode; label: string; score_percent: number; submitted_at: string | null }[];
}

export interface UniversalHeuristic {
  id: string;
  title: string;
  trigger: string;
  rule: string;
  caution: string;
}

export interface DomainHeuristic {
  trigger: string;
  points_to: string;
  why: string;
}

export interface Heuristics {
  note: string;
  universal: UniversalHeuristic[];
  domains: Record<string, DomainHeuristic[]>;
}
