import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptSummary } from "../lib/types";
import { Alert, Card, EmptyState, Spinner } from "../components/ui";
import { TONE_TEXT, formatDateTime, formatDuration, scoreTone } from "../lib/format";

type Filter = "all" | "practice" | "exam" | "open";

export default function History() {
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.attempts({ limit: 100 }).then(setAttempts).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load your history"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!attempts) return <Spinner label="Loading your history" />;

  const visible = attempts.filter((attempt) => {
    if (filter === "open") return attempt.status !== "submitted" && attempt.status !== "abandoned";
    if (filter === "all") return true;
    return attempt.mode === filter;
  });

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <h1 className="page-title">History</h1>
        <p className="page-sub">Every attempt you have started, with its scorecard and review.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "practice", "exam", "open"] as Filter[]).map((value) => (
          <button key={value} type="button"
                  className={`btn btn-sm ${filter === value ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                  onClick={() => setFilter(value)}>
            {value === "all" ? "Everything" : value === "open" ? "Still open"
              : value === "practice" ? "Practice" : "Exams"}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="◷" title="Nothing here yet"
                    body="Attempts appear as soon as you start one. Practice sets are untimed and pausable."
                    action={<Link to="/practice" className="btn-primary">Browse practice sets</Link>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-white/[0.03]">
                <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-5 py-3 text-left font-semibold">Attempt</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Answered</th>
                  <th className="px-5 py-3 text-right font-semibold">Time</th>
                  <th className="px-5 py-3 text-right font-semibold">Score</th>
                  <th className="px-5 py-3 text-right font-semibold">Date</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((attempt) => (
                  <tr key={attempt.id} className="border-t border-white/[0.05]">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-ink-100">{attempt.label}</div>
                      <div className="text-[11px] uppercase tracking-wider text-ink-600">{attempt.mode}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={
                        attempt.status === "submitted" ? "chip-mint"
                          : attempt.status === "paused" ? "chip-amber"
                          : attempt.status === "abandoned" ? "chip-neutral" : "chip-brand"
                      }>
                        {attempt.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-300">
                      {attempt.answered}/{attempt.total_questions}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-400">
                      {formatDuration(attempt.elapsed_seconds)}
                    </td>
                    <td className={`px-5 py-3.5 text-right font-semibold tabular-nums ${TONE_TEXT[scoreTone(attempt.score_percent)]}`}>
                      {attempt.score_percent === null ? "—" : `${attempt.score_percent}%`}
                    </td>
                    <td className="px-5 py-3.5 text-right text-xs text-ink-500">
                      {formatDateTime(attempt.submitted_at ?? attempt.started_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {attempt.status === "submitted" ? (
                        <Link to={`/attempt/${attempt.id}/review`} className="btn-ghost btn-sm">Review</Link>
                      ) : attempt.status === "abandoned" ? (
                        <span className="text-xs text-ink-600">—</span>
                      ) : (
                        <Link to={`/attempt/${attempt.id}`} className="btn-primary btn-sm">Resume</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
