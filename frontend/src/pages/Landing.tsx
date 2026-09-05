import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Blueprint } from "../lib/types";

const FEATURES = [
  {
    title: "300 practice sets, pausable",
    body: "Every set is 60 questions weighted to the blueprint and frozen by set number — Set 118 is the same paper next month as it is today. Pause any time; the clock stops and your paper resumes exactly as you left it.",
    icon: "▤",
  },
  {
    title: "Timed exam mode",
    body: "Sixty questions, ninety minutes, no pausing, server-enforced. Scenario-style items at the same cognitive level as the real sitting, so the rehearsal is honest.",
    icon: "◈",
  },
  {
    title: "Wrong answers teach",
    body: "Each miss returns the explanation, why every distractor is wrong, a real-world analogy (SDLC, CodePipeline, IAM, Kubernetes), a working code snippet, and the exact cheat-sheet section inlined.",
    icon: "◎",
  },
  {
    title: "Readiness, not vibes",
    body: "Per-domain mastery weighted by the blueprint gives a projected score, so you know which two domains to study rather than that you 'feel about ready'.",
    icon: "◧",
  },
];

export default function Landing() {
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);

  useEffect(() => { api.blueprint().then(setBlueprint).catch(() => undefined); }, []);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">C</span>
          <span className="text-[13px] font-bold tracking-tight text-white">CCAR-F Prep</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn btn-quiet btn-sm">Sign in</Link>
          <Link to="/register" className="btn btn-primary btn-sm">Create account</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="animate-rise py-16 sm:py-24">
          <span className="chip-brand">Claude Code Architect Foundations</span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl">
            Rehearse the exam,
            <span className="block bg-gradient-to-r from-brand-300 via-brand-400 to-sky-400 bg-clip-text text-transparent">
              not just the syllabus.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-300">
            {blueprint?.bank.total_questions ?? 200}+ original, scenario-style questions across{" "}
            {blueprint?.domains.length ?? 5} blueprint domains — with the explanation, the analogy,
            the snippet and the cheat sheet attached to every answer you get wrong.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/register" className="btn btn-primary px-6 py-3">Start practising free</Link>
            <Link to="/login" className="btn btn-ghost px-6 py-3">I already have an account</Link>
          </div>

          {blueprint && (
            <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-4">
              {[
                ["Practice sets", blueprint.practice_sets],
                ["Questions per paper", blueprint.question_count],
                ["Exam minutes", blueprint.duration_minutes],
                ["Pass mark", `${blueprint.pass_percent}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-ink-900/80 px-5 py-6">
                  <dd className="text-2xl font-bold tabular-nums text-white">{value}</dd>
                  <dt className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</dt>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="surface p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">{feature.body}</p>
            </div>
          ))}
        </section>

        {blueprint && (
          <section className="pb-20">
            <h2 className="text-xl font-bold text-white">The blueprint</h2>
            <p className="page-sub">
              Weightings drive how every practice set and exam paper is composed.
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.07]">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03]">
                  <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                    <th className="px-5 py-3 text-left font-semibold">Domain</th>
                    <th className="px-5 py-3 text-right font-semibold">Weight</th>
                    <th className="px-5 py-3 text-right font-semibold">Exam Qs</th>
                    <th className="hidden px-5 py-3 text-right font-semibold sm:table-cell">In bank</th>
                  </tr>
                </thead>
                <tbody>
                  {blueprint.domains.map((domain) => {
                    const bank = blueprint.bank.domains.find((d) => d.code === domain.code);
                    return (
                      <tr key={domain.code} className="border-t border-white/[0.05]">
                        <td className="px-5 py-3.5">
                          <span className="mr-2.5 font-mono text-[11px] text-ink-500">{domain.code}</span>
                          <span className="text-ink-100">{domain.name}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-brand-300">
                          {domain.weight_percent}%
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-ink-300">{domain.exam_questions}</td>
                        <td className="hidden px-5 py-3.5 text-right tabular-nums text-ink-400 sm:table-cell">
                          {bank?.count ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-5 max-w-3xl text-xs leading-relaxed text-ink-500">{blueprint.provenance}</p>
          </section>
        )}
      </main>
    </div>
  );
}
