import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Attempt } from "../lib/types";
import { Alert, Card, InlineCode, Spinner } from "../components/ui";
import { DIFFICULTY_LABEL, clamp, formatClock, formatDuration } from "../lib/format";

type Selections = Record<string, string[]>;
type Flags = Record<string, boolean>;

const AUTOSAVE_MS = 600;

export default function Runner() {
  const { id } = useParams<{ id: string }>();
  const attemptId = Number(id);
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [flags, setFlags] = useState<Flags>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [, setTick] = useState(0); // one-second heartbeat, re-renders the clock

  const clockBase = useRef({ elapsed: 0, at: Date.now() });
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const hydrate = useCallback((data: Attempt) => {
    setAttempt(data);
    setSelections(Object.fromEntries(Object.entries(data.answers).map(([qid, a]) => [qid, a.selected])));
    setFlags(Object.fromEntries(Object.entries(data.answers).map(([qid, a]) => [qid, a.flagged])));
    setIndex(clamp(data.cursor, 0, Math.max(data.questions.length - 1, 0)));
    clockBase.current = { elapsed: data.elapsed_seconds, at: Date.now() };
  }, []);

  useEffect(() => {
    if (!Number.isInteger(attemptId)) { setError("That attempt id is not valid."); return; }
    api.attempt(attemptId)
      .then((data) => {
        if (data.status === "submitted") { navigate(`/attempt/${data.id}/scorecard`, { replace: true }); return; }
        hydrate(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not open that attempt"));
  }, [attemptId, hydrate, navigate]);

  // One-second tick drives both the practice stopwatch and the exam countdown.
  const running = attempt?.status === "in_progress";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const elapsed = running
    ? clockBase.current.elapsed + Math.floor((Date.now() - clockBase.current.at) / 1000)
    : (attempt?.elapsed_seconds ?? 0);
  // Exam attempts carry a limit; the API reports remaining time at load, and the
  // client re-derives it from the ticking stopwatch so it stays accurate offline.
  const limit = attempt && attempt.remaining_seconds !== null
    ? attempt.remaining_seconds + attempt.elapsed_seconds
    : null;
  const timeLeft = limit === null ? null : Math.max(0, limit - elapsed);

  const submit = useCallback(async () => {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      // Flush anything still debounced before grading.
      for (const timer of pending.current.values()) clearTimeout(timer);
      pending.current.clear();
      await Promise.all(
        Object.entries(selections).map(([question_id, selected]) =>
          api.answer(attempt.id, { question_id, selected, flagged: !!flags[question_id] }).catch(() => undefined)),
      );
      await api.submit(attempt.id);
      navigate(`/attempt/${attempt.id}/scorecard`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
      setBusy(false);
    }
  }, [attempt, busy, flags, navigate, selections]);

  // Exam mode is wall-clock bounded; the server enforces it, the client just
  // stops pretending there is time left.
  useEffect(() => {
    if (timeLeft === 0 && running && !busy) void submit();
  }, [timeLeft, running, busy, submit]);

  const questions = attempt?.questions ?? [];
  const current = questions[index];

  const save = useCallback((questionId: string, selected: string[], flagged: boolean) => {
    if (!attempt) return;
    const existing = pending.current.get(questionId);
    if (existing) clearTimeout(existing);
    setSaveState("saving");
    const timer = setTimeout(async () => {
      pending.current.delete(questionId);
      try {
        await api.answer(attempt.id, { question_id: questionId, selected, flagged, seconds_spent: 0 });
        setSaveState("saved");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that answer");
        setSaveState("idle");
      }
    }, AUTOSAVE_MS);
    pending.current.set(questionId, timer);
  }, [attempt]);

  const choose = useCallback((optionKey: string) => {
    if (!current || !running) return;
    setSelections((prev) => {
      const before = prev[current.id] ?? [];
      let next: string[];
      if (current.select_count === 1) {
        next = before[0] === optionKey ? [] : [optionKey];
      } else if (before.includes(optionKey)) {
        next = before.filter((key) => key !== optionKey);
      } else if (before.length >= current.select_count) {
        // Oldest choice makes way, so the candidate is never stuck at the cap.
        next = [...before.slice(1), optionKey];
      } else {
        next = [...before, optionKey];
      }
      save(current.id, next, !!flags[current.id]);
      return { ...prev, [current.id]: next };
    });
  }, [current, flags, running, save]);

  const toggleFlag = useCallback(() => {
    if (!current) return;
    setFlags((prev) => {
      const next = { ...prev, [current.id]: !prev[current.id] };
      save(current.id, selections[current.id] ?? [], next[current.id]);
      return next;
    });
  }, [current, save, selections]);

  const go = useCallback((next: number) => {
    if (!attempt) return;
    const bounded = clamp(next, 0, questions.length - 1);
    setIndex(bounded);
    api.cursor(attempt.id, bounded).catch(() => undefined);
  }, [attempt, questions.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (!current || !running) return;

      if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      else if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFlag(); }
      else if (/^[1-9]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (option) { event.preventDefault(); choose(option.key); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, current, go, index, running, toggleFlag]);

  const answeredCount = useMemo(
    () => questions.filter((q) => (selections[q.id] ?? []).length > 0).length,
    [questions, selections],
  );

  if (error && !attempt) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <Alert>{error}</Alert>
        <button type="button" className="btn-ghost mt-4" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </button>
      </div>
    );
  }
  if (!attempt || !current) return <Spinner label="Loading your paper" />;

  /* ---------------------------------------------------------------- paused */
  if (attempt.status === "paused") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Card className="w-full p-8 text-center animate-rise">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-xl text-amber-500">
            ‖
          </div>
          <h1 className="text-xl font-bold text-white">{attempt.label} is paused</h1>
          <p className="mt-2 text-sm text-ink-400">
            The clock is stopped. Your answers and question order are exactly as you left them.
          </p>
          <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07]">
            <div className="bg-ink-900 px-4 py-4">
              <dd className="text-xl font-bold tabular-nums text-white">
                {attempt.answered}/{attempt.total_questions}
              </dd>
              <dt className="stat-label mt-1">Answered</dt>
            </div>
            <div className="bg-ink-900 px-4 py-4">
              <dd className="text-xl font-bold tabular-nums text-white">{formatDuration(attempt.elapsed_seconds)}</dd>
              <dt className="stat-label mt-1">Time spent</dt>
            </div>
          </dl>
          <div className="mt-7 flex gap-2">
            <button type="button" className="btn-primary grow" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { hydrate(await api.resume(attempt.id)); }
                      catch (err) { setError(err instanceof Error ? err.message : "Could not resume"); }
                      finally { setBusy(false); }
                    }}>
              Resume
            </button>
            <button type="button" className="btn-ghost" onClick={() => navigate("/practice")}>
              Later
            </button>
          </div>
        </Card>
      </div>
    );
  }

  /* --------------------------------------------------------------- running */
  const selected = selections[current.id] ?? [];
  const isExam = attempt.mode === "exam";
  const lowTime = timeLeft !== null && timeLeft <= 300;

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-ink-950/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{attempt.label}</div>
            <div className="text-[11px] text-ink-500">
              Question {index + 1} of {questions.length} · {answeredCount} answered
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className={`rounded-lg px-3 py-1.5 font-mono text-sm tabular-nums ${
              isExam ? (lowTime ? "bg-rose-500/15 text-rose-500" : "bg-white/[0.05] text-ink-200")
                     : "bg-white/[0.05] text-ink-300"
            }`}
                 title={isExam ? "Time remaining" : "Time spent"}>
              {isExam && timeLeft !== null ? formatClock(timeLeft) : formatClock(elapsed)}
            </div>

            {attempt.can_pause && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const summary = await api.pause(attempt.id);
                          setAttempt({ ...attempt, ...summary, questions: attempt.questions, answers: attempt.answers });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Could not pause");
                        } finally { setBusy(false); }
                      }}>
                ‖ Pause
              </button>
            )}

            <button type="button" className="btn-ghost btn-sm" onClick={() => setPaletteOpen((open) => !open)}
                    aria-expanded={paletteOpen}>
              ▦ Overview
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setConfirmSubmit(true)}>
              Submit
            </button>
          </div>
        </div>

        <div className="h-0.5 w-full bg-white/[0.05]">
          <div className="h-full bg-brand-500 transition-[width] duration-300"
               style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
        </div>
      </header>

      {paletteOpen && (
        <div className="border-b border-white/[0.07] bg-ink-900/70 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-4 py-5">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-400">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded bg-brand-500" />answered</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded bg-amber-500" />flagged</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded bg-white/10" />untouched</span>
            </div>
            <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-15 md:grid-cols-20">
              {questions.map((question, i) => {
                const done = (selections[question.id] ?? []).length > 0;
                const flagged = flags[question.id];
                return (
                  <button key={question.id} type="button"
                          onClick={() => { go(i); setPaletteOpen(false); }}
                          aria-label={`Question ${i + 1}${done ? ", answered" : ""}${flagged ? ", flagged" : ""}`}
                          className={`h-8 rounded-md text-[11px] font-semibold tabular-nums transition-colors ${
                            i === index ? "ring-2 ring-white" : ""
                          } ${
                            flagged ? "bg-amber-500 text-ink-950"
                              : done ? "bg-brand-500 text-white"
                              : "bg-white/[0.06] text-ink-400 hover:bg-white/[0.12]"
                          }`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-10">
        {error && <div className="mb-6"><Alert tone="amber">{error}</Alert></div>}

        <div key={current.id} className="animate-rise">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="chip-neutral font-mono">{current.domain}</span>
            <span className="chip-neutral">{DIFFICULTY_LABEL[current.difficulty]}</span>
            {current.select_count > 1 && (
              <span className="chip-brand">Select {current.select_count}</span>
            )}
            <button type="button" onClick={toggleFlag}
                    className={`ml-auto btn btn-sm ${flags[current.id] ? "chip-amber" : "btn-quiet"}`}>
              {flags[current.id] ? "⚑ Flagged" : "⚐ Flag for review"}
            </button>
          </div>

          <h1 className="text-lg font-medium leading-relaxed text-white sm:text-xl">
            <InlineCode text={current.stem} />
          </h1>

          <div className="mt-7 space-y-2.5" role={current.select_count > 1 ? "group" : "radiogroup"}>
            {current.options.map((option, i) => {
              const active = selected.includes(option.key);
              return (
                <button key={option.key} type="button" onClick={() => choose(option.key)}
                        aria-pressed={active}
                        className={`flex w-full items-start gap-4 rounded-xl border px-4 py-3.5 text-left transition-all ${
                          active
                            ? "border-brand-400/60 bg-brand-500/[0.12]"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
                        }`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold transition-colors ${
                    current.select_count > 1 ? "rounded-md" : "rounded-full"
                  } ${active ? "bg-brand-500 text-white" : "bg-white/[0.07] text-ink-400"}`}>
                    {option.key}
                  </span>
                  <span className="text-[14.5px] leading-relaxed text-ink-100">
                    <InlineCode text={option.text} />
                  </span>
                  <span className="ml-auto hidden shrink-0 self-center text-[10px] text-ink-600 sm:block">
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-[11px] text-ink-600">
            Keyboard: <kbd className="font-mono">1–{current.options.length}</kbd> select ·{" "}
            <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> navigate ·{" "}
            <kbd className="font-mono">F</kbd> flag
            {saveState === "saving" && <span className="ml-3 text-ink-500">saving…</span>}
            {saveState === "saved" && <span className="ml-3 text-mint-400">saved</span>}
          </p>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-ink-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          <button type="button" className="btn-ghost" disabled={index === 0} onClick={() => go(index - 1)}>
            ← Previous
          </button>
          <div className="grow text-center text-xs text-ink-500">
            {questions.length - answeredCount > 0
              ? `${questions.length - answeredCount} unanswered`
              : "All questions answered"}
          </div>
          {index === questions.length - 1 ? (
            <button type="button" className="btn-primary" onClick={() => setConfirmSubmit(true)}>
              Finish & submit
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => go(index + 1)}>Next →</button>
          )}
        </div>
      </nav>

      {confirmSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
             role="dialog" aria-modal="true">
          <Card raised className="w-full max-w-md p-7 animate-rise">
            <h2 className="text-lg font-bold text-white">Submit this {isExam ? "exam" : "set"}?</h2>
            <p className="mt-2 text-sm text-ink-400">
              {questions.length - answeredCount > 0 ? (
                <>
                  <strong className="text-amber-500">{questions.length - answeredCount} questions are unanswered</strong>{" "}
                  and will be marked incorrect. You cannot return to this attempt afterwards.
                </>
              ) : (
                "All questions answered. Your scorecard and the full review unlock immediately."
              )}
            </p>
            <div className="mt-7 flex gap-2">
              <button type="button" className="btn-primary grow" onClick={submit} disabled={busy}>
                {busy ? "Grading…" : "Submit and see my score"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmSubmit(false)} disabled={busy}>
                Keep working
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
