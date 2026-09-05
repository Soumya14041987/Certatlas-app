import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptSummary, SetSummary } from "../lib/types";
import { Alert, Card, Meter, Spinner } from "../components/ui";
import { TONE_TEXT, scoreTone } from "../lib/format";

const INTENSITY = {
  steady: { label: "Steady", className: "chip-mint" },
  moderate: { label: "Moderate", className: "chip-brand" },
  high: { label: "Demanding", className: "chip-amber" },
} as const;

type Filter = "all" | "unattempted" | "open" | "completed";

export default function PracticeSets() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [jump, setJump] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingSet, setStartingSet] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.sets(page, 30), api.attempts({ mode: "practice", limit: 100 })])
      .then(([catalogue, history]) => {
        setSets(catalogue.sets);
        setPages(catalogue.pages);
        setAttempts(history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the catalogue"))
      .finally(() => setLoading(false));
  }, [page]);

  /** Latest attempt per set number, so a card can show its own state. */
  const bySet = useMemo(() => {
    const map = new Map<number, AttemptSummary>();
    for (const attempt of attempts) {
      if (attempt.set_number === null) continue;
      const existing = map.get(attempt.set_number);
      // Prefer an open attempt; otherwise keep the best submitted score.
      const better =
        !existing ||
        (attempt.status !== "submitted" && existing.status === "submitted") ||
        (attempt.status === "submitted" && existing.status === "submitted" &&
          (attempt.score_percent ?? 0) > (existing.score_percent ?? 0));
      if (better) map.set(attempt.set_number, attempt);
    }
    return map;
  }, [attempts]);

  const visible = sets.filter((set) => {
    const attempt = bySet.get(set.set_number);
    if (filter === "unattempted") return !attempt;
    if (filter === "open") return attempt && attempt.status !== "submitted";
    if (filter === "completed") return attempt?.status === "submitted";
    return true;
  });

  async function open(setNumber: number) {
    setStartingSet(setNumber);
    try {
      const attempt = await api.startPractice(setNumber);
      navigate(`/attempt/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that set");
      setStartingSet(null);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Practice sets</h1>
          <p className="page-sub">
            300 papers of 60 questions each, weighted to the blueprint. Untimed and pausable —
            every set is fixed, so Set 042 is the same paper each time you sit it.
          </p>
        </div>
        <form className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const n = Number(jump);
                if (Number.isInteger(n) && n >= 1 && n <= 300) {
                  setPage(Math.ceil(n / 30));
                  setJump("");
                }
              }}>
          <input className="field w-32 py-2" placeholder="Go to set…" inputMode="numeric"
                 value={jump} onChange={(event) => setJump(event.target.value)} aria-label="Jump to set number" />
          <button type="submit" className="btn-ghost">Go</button>
        </form>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "unattempted", "open", "completed"] as Filter[]).map((value) => (
          <button key={value} type="button"
                  className={`btn btn-sm ${filter === value ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                  onClick={() => setFilter(value)}>
            {value === "all" ? "All sets" : value === "unattempted" ? "Not attempted"
              : value === "open" ? "In progress" : "Completed"}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-500">Page {page} of {pages}</span>
      </div>

      {loading ? (
        <Spinner label="Loading sets" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((set) => {
            const attempt = bySet.get(set.set_number);
            const intensity = INTENSITY[set.intensity];
            const done = attempt?.status === "submitted";
            return (
              <Card key={set.set_number} className="flex flex-col p-5 transition-colors hover:border-brand-400/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-wider text-ink-500">
                      Set {String(set.set_number).padStart(3, "0")}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white">{set.size} questions</div>
                  </div>
                  <span className={intensity.className}>{intensity.label}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] text-ink-400">
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">
                    {set.difficulty.foundational} foundational
                  </span>
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">
                    {set.difficulty.applied} applied
                  </span>
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">
                    {set.difficulty.architect} architect
                  </span>
                </div>

                <div className="mt-5 grow">
                  {done ? (
                    <>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-xs text-ink-400">Best score</span>
                        <span className={`text-sm font-semibold tabular-nums ${TONE_TEXT[scoreTone(attempt.score_percent)]}`}>
                          {attempt.score_percent}%
                        </span>
                      </div>
                      <Meter percent={attempt.score_percent ?? 0} height="h-1.5" />
                    </>
                  ) : attempt ? (
                    <>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-xs text-ink-400">
                          {attempt.status === "paused" ? "Paused" : "In progress"}
                        </span>
                        <span className="text-xs tabular-nums text-ink-300">
                          {attempt.answered}/{attempt.total_questions}
                        </span>
                      </div>
                      <Meter percent={(attempt.answered / attempt.total_questions) * 100} tone="brand" height="h-1.5" />
                    </>
                  ) : (
                    <p className="text-xs text-ink-500">Not attempted yet.</p>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <button type="button" className="btn-primary btn-sm grow"
                          disabled={startingSet === set.set_number}
                          onClick={() => open(set.set_number)}>
                    {startingSet === set.set_number ? "Opening…"
                      : attempt && attempt.status !== "submitted" ? "Resume"
                      : done ? "Retake" : "Start"}
                  </button>
                  {done && (
                    <button type="button" className="btn-ghost btn-sm"
                            onClick={() => navigate(`/attempt/${attempt.id}/review`)}>
                      Review
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {visible.length === 0 && !loading && (
        <Card className="px-6 py-12 text-center text-sm text-ink-400">
          No sets on this page match that filter.
        </Card>
      )}

      <div className="flex items-center justify-center gap-2 pt-2">
        <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Previous
        </button>
        <div className="flex gap-1">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button"
                    className={`h-8 w-8 rounded-lg text-xs font-semibold tabular-nums transition-colors ${
                      n === page ? "bg-brand-500 text-white" : "text-ink-400 hover:bg-white/[0.06] hover:text-white"
                    }`}
                    onClick={() => setPage(n)}>
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
