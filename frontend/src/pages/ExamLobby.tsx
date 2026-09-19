import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptSummary, Blueprint } from "../lib/types";
import { Alert, Card, SectionHeading, Spinner } from "../components/ui";
import { TONE_TEXT, formatDate, formatDuration, scoreTone } from "../lib/format";

export default function ExamLobby() {
  const navigate = useNavigate();
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState<"full" | "quick" | null>(null);

  useEffect(() => {
    Promise.all([api.blueprint(), api.attempts({ mode: "exam", limit: 20 })])
      .then(([bp, attempts]) => { setBlueprint(bp); setHistory(attempts); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load exam mode"));
  }, []);

  if (!blueprint) return <Spinner label="Preparing exam mode" />;

  const open = history.find((a) => a.status === "in_progress");
  const submitted = history.filter((a) => a.status === "submitted");

  async function begin(quick: boolean) {
    setStarting(true);
    setError(null);
    try {
      const attempt = await api.startExam(quick);
      navigate(`/attempt/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the exam");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <h1 className="page-title">Exam mode</h1>
        <p className="page-sub">
          A full mock sitting under real conditions. {blueprint.question_count} questions,{" "}
          {blueprint.duration_minutes} minutes, no pausing.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {open && (
        <Card className="border-amber-500/30 bg-amber-500/[0.07] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">An exam is already running</div>
              <div className="mt-0.5 text-xs text-ink-400">
                {open.answered}/{open.total_questions} answered ·{" "}
                {open.remaining_seconds !== null ? `${formatDuration(open.remaining_seconds)} remaining` : ""}
              </div>
            </div>
            <Link to={`/attempt/${open.id}`} className="btn-primary btn-sm">Return to the exam</Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <SectionHeading title="Before you begin" hint="Exam mode is deliberately unforgiving" />
          <ul className="space-y-3.5 text-sm text-ink-300">
            {[
              [`${blueprint.duration_minutes} minutes, enforced server-side`, "Closing the tab does not stop the clock. The paper submits itself when time runs out."],
              ["No pausing", "Practice mode is where you pause. This mode exists to rehearse time pressure."],
              [`${blueprint.question_count} questions, blueprint-weighted`, "Same domain distribution as the real paper, freshly composed for each sitting."],
              ["All-or-nothing multi-select", "Multi-response items need every correct option and no incorrect one — partial credit does not exist."],
              [`Pass mark ${blueprint.pass_percent}%`, "Answers, explanations and cheat sheets unlock only after you submit."],
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
            {confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-300">
                  The timer starts immediately. Ready?
                </span>
                <button type="button" className="btn-primary" onClick={() => begin(confirming === "quick")} disabled={starting || !!open}>
                  {starting ? "Starting…" : "Yes — start the clock"}
                </button>
                <button type="button" className="btn-quiet" onClick={() => setConfirming(null)}>Not yet</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-primary px-6 py-3" disabled={!!open}
                        onClick={() => setConfirming("full")}>
                  Begin full mock exam
                </button>
                <button type="button" className="btn-ghost px-6 py-3" disabled={!!open}
                        onClick={() => setConfirming("quick")}>
                  Quick scenario mock · ~28 questions · 56 min
                </button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeading title="Paper composition" />
          <div className="space-y-2.5">
            {blueprint.domains.map((domain) => (
              <div key={domain.code} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-300">
                  <span className="mr-2 font-mono text-[11px] text-ink-500">{domain.code}</span>
                  {domain.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-white">{domain.exam_questions}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-xs leading-relaxed text-ink-500">
            {blueprint.scoring}
          </p>
        </Card>
      </div>

      {submitted.length > 0 && (
        <Card className="p-6">
          <SectionHeading title="Past sittings" />
          <div className="divide-y divide-white/[0.05]">
            {submitted.map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm text-ink-100">{formatDate(attempt.submitted_at)}</div>
                  <div className="text-xs text-ink-500">
                    {attempt.answered}/{attempt.total_questions} answered · {formatDuration(attempt.elapsed_seconds)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={attempt.passed ? "chip-mint" : "chip-rose"}>
                    {attempt.passed ? "Pass" : "Below pass"}
                  </span>
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
