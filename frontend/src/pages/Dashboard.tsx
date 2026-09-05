import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Analytics, AttemptSummary } from "../lib/types";
import { Alert, Card, DomainBars, EmptyState, SectionHeading, Spinner, Stat, TrendChart } from "../components/ui";
import { TONE_TEXT, formatDate, formatDuration, scoreTone } from "../lib/format";

const READINESS = {
  not_started: { label: "Not started", tone: "neutral", copy: "Submit a practice set to get your first readiness estimate." },
  not_ready: { label: "Not ready", tone: "rose", copy: "Projected below the pass mark. Focus on your two weakest domains before booking." },
  borderline: { label: "Borderline", tone: "amber", copy: "You are around the pass mark. Aim for a comfortable margin, not a coin flip." },
  ready: { label: "Ready", tone: "mint", copy: "Comfortably above the pass mark across the blueprint. Rehearse in exam mode." },
} as const;

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [open, setOpen] = useState<AttemptSummary[]>([]);
  const [recent, setRecent] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([api.analytics(), api.attempts({ limit: 40 })])
      .then(([overview, attempts]) => {
        setAnalytics(overview);
        setOpen(attempts.filter((a) => a.status === "in_progress" || a.status === "paused"));
        setRecent(attempts.filter((a) => a.status === "submitted").slice(0, 5));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your dashboard"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!analytics) return <Spinner label="Loading your progress" />;

  const readiness = READINESS[analytics.readiness];
  const projected = analytics.projected_score;
  const firstName = user?.full_name.split(" ")[0] ?? "there";

  async function startNextSet() {
    setStarting(true);
    try {
      const next = (analytics!.practice_submitted % 300) + 1;
      const attempt = await api.startPractice(next);
      navigate(`/attempt/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a set");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-8 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Good to see you, {firstName}.</h1>
          <p className="page-sub">
            {analytics.attempts_submitted === 0
              ? "Nothing submitted yet — start with a practice set to calibrate."
              : `${analytics.attempts_submitted} attempts submitted · ${analytics.questions_answered} questions graded`}
            {analytics.days_until_exam !== null && (
              <> · <span className="text-amber-500">{analytics.days_until_exam} days until your target date</span></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={startNextSet} disabled={starting}>
            {starting ? "Starting…" : "Start next practice set"}
          </button>
          <Link to="/exam" className="btn-ghost">Take a mock exam</Link>
        </div>
      </div>

      {open.length > 0 && (
        <Card className="border-brand-400/25 bg-brand-500/[0.07] p-5">
          <SectionHeading title="Pick up where you left off" hint={`${open.length} attempt${open.length > 1 ? "s" : ""} still open`} />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {open.map((attempt) => (
              <Link key={attempt.id} to={`/attempt/${attempt.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-ink-900/70 px-4 py-3 transition-colors hover:border-brand-400/40">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{attempt.label}</div>
                  <div className="mt-0.5 text-xs text-ink-400">
                    {attempt.answered}/{attempt.total_questions} answered · {formatDuration(attempt.elapsed_seconds)}
                  </div>
                </div>
                <span className={attempt.status === "paused" ? "chip-amber" : "chip-brand"}>
                  {attempt.status === "paused" ? "Paused" : "In progress"}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Projected score" tone={scoreTone(projected, analytics.pass_mark)}
              value={projected === null ? "—" : `${projected}%`}
              sub={`Pass mark ${analytics.pass_mark}% · blueprint-weighted`} />
        <Stat label="Best result" tone={scoreTone(analytics.best_score, analytics.pass_mark)}
              value={analytics.best_score === null ? "—" : `${analytics.best_score}%`}
              sub={analytics.latest_score === null ? "No attempts yet" : `Latest ${analytics.latest_score}%`} />
        <Stat label="Practice sets" value={analytics.practice_submitted} sub="of 300 available" />
        <Stat label="Mock exams" value={analytics.exams_submitted}
              sub={analytics.exams_submitted === 0 ? "Rehearse under time pressure" : "Timed sittings completed"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <SectionHeading title="Domain mastery" hint="Accuracy across everything you have submitted" />
          {analytics.domains.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">
              Per-domain accuracy appears after your first submitted attempt.
            </p>
          ) : (
            <DomainBars passMark={analytics.pass_mark}
                        rows={analytics.domains.map((d) => ({ code: d.code, name: d.name, percent: d.percent, total: d.total }))} />
          )}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <SectionHeading title="Readiness" />
          <div className={`text-2xl font-bold ${TONE_TEXT[readiness.tone]}`}>{readiness.label}</div>
          <p className="mt-2 text-sm leading-relaxed text-ink-400">{readiness.copy}</p>

          {analytics.focus_areas.length > 0 && (
            <>
              <div className="stat-label mt-7 mb-3">Study these next</div>
              <ol className="space-y-2.5">
                {analytics.focus_areas.map((area, index) => (
                  <li key={area.code} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[11px] font-bold text-ink-300">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink-100">{area.name}</div>
                      <div className="text-xs text-ink-500">
                        {area.percent === null ? "not yet covered" : `${area.percent}% accuracy`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <Link to="/cheatsheets" className="btn-ghost btn-sm mt-6 w-full">Open the cheat sheets</Link>
            </>
          )}
        </Card>
      </div>

      {analytics.trend.length > 0 ? (
        <Card className="p-6">
          <SectionHeading title="Score trend" hint="Every submitted attempt, oldest first" />
          <TrendChart passMark={analytics.pass_mark}
                      points={analytics.trend.map((t) => ({ score_percent: t.score_percent, label: t.label }))} />
        </Card>
      ) : (
        <EmptyState icon="▤" title="No results yet"
                    body="Practice sets are untimed and pausable — a good first step is Set 001, then read the review carefully."
                    action={<Link to="/practice" className="btn-primary">Browse practice sets</Link>} />
      )}

      {recent.length > 0 && (
        <Card className="p-6">
          <SectionHeading title="Recent results" action={<Link to="/history" className="btn-quiet btn-sm">View all</Link>} />
          <div className="divide-y divide-white/[0.05]">
            {recent.map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink-100">{attempt.label}</div>
                  <div className="text-xs text-ink-500">
                    {formatDate(attempt.submitted_at)} · {formatDuration(attempt.elapsed_seconds)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-semibold tabular-nums ${TONE_TEXT[scoreTone(attempt.score_percent, analytics.pass_mark)]}`}>
                    {attempt.score_percent}%
                  </span>
                  <Link to={`/attempt/${attempt.id}/review`} className="btn-ghost btn-sm">Review</Link>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
