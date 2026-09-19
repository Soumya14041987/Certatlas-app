import type { Scenario } from "../lib/types";

export default function ScenarioCard({ scenario }: { scenario?: Scenario | null }) {
  if (!scenario) return null;
  return (
    <div className="mb-5 rounded-xl border border-brand-400/25 bg-brand-500/[0.06] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-300">Scenario</div>
      <div className="mt-1 text-sm font-semibold text-white">{scenario.title}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-300">{scenario.body}</p>
    </div>
  );
}
