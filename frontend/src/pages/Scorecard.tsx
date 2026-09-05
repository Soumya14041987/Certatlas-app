import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Scorecard } from "../lib/types";
import { Alert, Card, DomainBars, Meter, SectionHeading, Spinner } from "../components/ui";
import { TONE_TEXT, formatDateTime, formatDuration, scoreTone } from "../lib/format";

export default function ScorecardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<Scorecard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.scorecard(Number(id))
      .then(setCard)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load that scorecard"));
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!card) return <Spinner label="Publishing your scorecard" />;

  const tone = scoreTone(card.score_percent, card.pass_mark);
  const rows = Object.entries(card.domain_breakdown).map(([code, stats]) => ({
    code, name: stats.name, percent: stats.percent, total: stats.total,
  }));
  const wrong = card.total - card.correct;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-ink-500">
            {card.mode === "exam" ? "Mock exam result" : "Practice result"}
          </div>
          <h1 className="page-title mt-1">{card.label}</h1>
          <p className="page-sub">Submitted {formatDateTime(card.submitted_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/attempt/${card.attempt_id}/review?only_incorrect=1`} className="btn-primary">
            Review {wrong} wrong answer{wrong === 1 ? "" : "s"}
          </Link>
          <Link to={`/attempt/${card.attempt_id}/review`} className="btn-ghost">Review everything</Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-px bg-white/[0.07] sm:grid-cols-4">
          <div className="bg-ink-900 p-7 sm:col-span-2">
            <div className="stat-label">Score</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className={`text-6xl font-bold tabular-nums tracking-tight ${TONE_TEXT[tone]}`}>
                {card.score_percent}
              </span>
              <span className="text-2xl font-semibold text-ink-500">%</span>
              <span className={`ml-2 ${card.passed ? "chip-mint" : "chip-rose"}`}>
                {card.passed ? "Pass" : "Below pass"}
              </span>
            </div>
            <div className="mt-5">
              <Meter percent={card.score_percent} tone={tone} height="h-2.5" />
              <div className="mt-2 flex justify-between text-[11px] text-ink-500">
                <span>{card.correct} of {card.total} correct</span>
                <span>pass mark {card.pass_mark}%</span>
              </div>
            </div>
          </div>
          <div className="bg-ink-900 p-7">
            <div className="stat-label">Time taken</div>
            <div className="stat-value mt-2">{formatDuration(card.elapsed_seconds)}</div>
            <div className="mt-1 text-xs text-ink-400">{card.seconds_per_question}s per question</div>
          </div>
          <div className="bg-ink-900 p-7">
            <div className="stat-label">To review</div>
            <div className="stat-value mt-2">{wrong}</div>
            <div className="mt-1 text-xs text-ink-400">
              {wrong === 0 ? "Nothing missed" : "Each with a cheat-sheet section"}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <SectionHeading title="Domain breakdown" hint="Where the marks were won and lost on this paper" />
          <DomainBars rows={rows} passMark={card.pass_mark} />
        </Card>

        <Card className="p-6 lg:col-span-2">
          <SectionHeading title="What to do next" />
          {card.focus_areas.length === 0 ? (
            <p className="text-sm text-ink-400">Nothing stands out — keep the cadence up.</p>
          ) : (
            <ol className="space-y-4">
              {card.focus_areas.map((area, index) => (
                <li key={area.code} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[11px] font-bold text-ink-300">
                    {index + 1}
                  </span>
                  <div>
                    <div className="text-[13px] text-ink-100">{area.name}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{area.percent}% on this paper</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-7 space-y-2">
            <Link to="/cheatsheets" className="btn-ghost btn-sm w-full">Open the cheat sheets</Link>
            <button type="button" className="btn-ghost btn-sm w-full"
                    onClick={async () => {
                      if (card.mode === "exam") { navigate("/exam"); return; }
                      const next = ((card.set_number ?? 0) % 300) + 1;
                      const attempt = await api.startPractice(next);
                      navigate(`/attempt/${attempt.id}`);
                    }}>
              {card.mode === "exam" ? "Back to exam mode" : `Start set ${String(((card.set_number ?? 0) % 300) + 1).padStart(3, "0")}`}
            </button>
          </div>
        </Card>
      </div>

      {wrong > 0 && (
        <Card className="border-brand-400/25 bg-brand-500/[0.06] p-6">
          <h3 className="text-base font-semibold text-white">The review is where the learning happens</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-300">
            Every question you missed comes back with the reasoning, a note on why each distractor
            is wrong, an analogy from a system you already know, a working snippet, and the exact
            cheat-sheet section — inline, so you never have to go looking.
          </p>
          <Link to={`/attempt/${card.attempt_id}/review?only_incorrect=1`} className="btn-primary mt-5">
            Start the review
          </Link>
        </Card>
      )}
    </div>
  );
}
