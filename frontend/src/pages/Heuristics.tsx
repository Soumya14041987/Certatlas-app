import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Heuristics } from "../lib/types";
import { Alert, Card, SectionHeading, Spinner } from "../components/ui";

export default function HeuristicsPage() {
  const [data, setData] = useState<Heuristics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("all");

  useEffect(() => {
    api.heuristics().then(setData).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load Exam Instincts"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner label="Loading Exam Instincts" />;

  const domainCodes = Object.keys(data.domains);
  const visibleDomains = domainFilter === "all" ? domainCodes : [domainFilter];

  return (
    <div className="space-y-8 animate-rise">
      <div>
        <h1 className="page-title">Exam Instincts</h1>
        <p className="page-sub max-w-3xl">
          Not more content to memorise — a set of shortcuts for reading a question fast. Spot the
          trigger phrase in the stem, name the mechanism it's pointing at, <em>then</em> look at the
          options. {data.note}
        </p>
      </div>

      <Card className="p-6">
        <SectionHeading title="Universal instincts" hint="Apply to any question, in any domain" />
        <div className="grid gap-3 lg:grid-cols-2">
          {data.universal.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-sm font-semibold text-white">{item.title}</h3>

              <div className="mt-3 flex gap-2.5">
                <span className="chip-amber mt-0.5 shrink-0">If</span>
                <p className="text-[13px] leading-relaxed text-ink-300">{item.trigger}</p>
              </div>
              <div className="mt-2 flex gap-2.5">
                <span className="chip-mint mt-0.5 shrink-0">Then</span>
                <p className="text-[13px] leading-relaxed text-ink-100">{item.rule}</p>
              </div>
              <div className="mt-3 border-t border-white/[0.06] pt-2.5 text-[12px] leading-relaxed text-ink-500">
                <span className="font-semibold text-ink-400">Watch out: </span>{item.caution}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading title="Domain quick triggers"
                        hint="Keyword in the stem → the mechanism it's almost certainly testing" />

        <div className="mb-5 flex flex-wrap gap-2">
          <button type="button"
                  className={`btn btn-sm ${domainFilter === "all" ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                  onClick={() => setDomainFilter("all")}>
            All domains
          </button>
          {domainCodes.map((code) => (
            <button key={code} type="button"
                    className={`btn btn-sm font-mono ${domainFilter === code ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                    onClick={() => setDomainFilter(code)}>
              {code}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {visibleDomains.map((code) => (
            <div key={code}>
              <div className="mb-2.5 chip-brand font-mono">{code}</div>
              <div className="overflow-hidden rounded-xl border border-white/[0.07]">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03]">
                    <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                      <th className="w-[38%] px-4 py-2.5 text-left font-semibold">If the stem says…</th>
                      <th className="w-[32%] px-4 py-2.5 text-left font-semibold">…it's testing</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.domains[code].map((item, i) => (
                      <tr key={i} className="border-t border-white/[0.05] align-top">
                        <td className="px-4 py-3 text-[13px] text-ink-200">{item.trigger}</td>
                        <td className="px-4 py-3 text-[13px] font-medium text-mint-400">{item.points_to}</td>
                        <td className="px-4 py-3 text-[12.5px] leading-relaxed text-ink-400">{item.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
