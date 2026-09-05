import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptSummary, Blueprint } from "../lib/types";
import { Alert, Card, SectionHeading, Spinner } from "../components/ui";
import { TONE_TEXT, formatDate, formatDuration, scoreTone } from "../lib/format";

export default function Diagnostic() {
  const navigate = useNavigate();
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([api.blueprint(), api.attempts({ mode: "diagnostic", limit: 20 })])
      .then(([bp, attempts]) => { setBlueprint(bp); setHistory(attempts); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the readiness check"));
  }, []);

  if (!blueprint) return <Spinner label="Preparing your readiness check" />;

  const open = history.find((a) => a.status === "in_progress" || a.status === "paused");
  const submitted = history.filter((a) => a.status === "submitted");

  async function begin() {
    setStarting(true);
    setError(null);
    try {
      const attempt = await api.startDiagnostic();
      navigate(`/attempt/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the readiness check");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <h1 className="page-title">Readiness check</h1>
        <p className="page-sub max-w-2xl">
          {blueprint.bank.total_questions >= 25 ? 25 : blueprint.bank.total_questions} quick questions,
          blueprint-weighted the same way the real exam is, so your result is a genuine cross-section —
          not a lucky or unlucky corner of one domain. Untimed and pausable, like practice mode.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {open && (
        <Card className="border-amber-500/30 bg-amber-500/[0.07] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">You have a readiness check open</div>
              <div className="mt-0.5 text-xs text-ink-400">
                {open.answered}/{open.total_questions} answered
              </div>
            </div>
            <Link to={`/attempt/${open.id}`} className="btn-primary btn-sm">Continue</Link>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <SectionHeading title="What this is for" hint="Not a test to pass or fail — a starting point" />
        <ul className="space-y-3.5 text-sm text-ink-300">
          {[
            ["A fast baseline", "25 questions take a fraction of the time a full 60-question paper does, and give you a per-domain read on where you stand right now."],
            ["Feeds your focus set", "Once it's submitted, the app can generate a personalised 60-question set weighted toward whatever you scored weakest on — still covering every domain, just leaning where you need it most."],
            ["No pressure", "Untimed, pausable, retakeable any time. This exists to point your study time at the right places, not to simulate exam-day stress — that's what Exam mode is for."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <div>
                <div className="font-medium text-white">{title}</div>
                <div className="mt-0.5 text-ink-400">{body}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 border-t border-white/[0.07] pt-6">
          <button type="button" className="btn-primary px-6 py-3" disabled={starting || !!open} onClick={begin}>
            {starting ? "Starting…" : open ? "Already in progress" : "Start the readiness check"}
          </button>
        </div>
      </Card>

      {submitted.length > 0 && (
        <Card className="p-6">
          <SectionHeading title="Past readiness checks" />
          <div className="divide-y divide-white/[0.05]">
            {submitted.map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm text-ink-100">{formatDate(attempt.submitted_at)}</div>
                  <div className="text-xs text-ink-500">{formatDuration(attempt.elapsed_seconds)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-semibold tabular-nums ${TONE_TEXT[scoreTone(attempt.score_percent, blueprint.pass_percent)]}`}>
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
