import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Alert, Card, SectionHeading, Spinner } from "./ui";
import type { Blueprint } from "../lib/types";
import { formatDate } from "../lib/format";

export default function AdminFreshness() {
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [verifiedBy, setVerifiedBy] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.blueprint().then(setBlueprint).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load the blueprint"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!blueprint) return <Spinner label="Loading content freshness" />;

  async function markReviewed() {
    if (!verifiedBy.trim()) { setError("Enter your name so the record shows who checked."); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.adminMarkReviewed(verifiedBy.trim(), version.trim() || undefined);
      setBlueprint((prev) => prev && {
        ...prev,
        version: result.version,
        freshness: { ...prev.freshness, last_verified: result.last_verified, verified_by: result.verified_by },
      });
      setMessage(`Marked reviewed as of ${result.last_verified}.`);
      setVersion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <SectionHeading title="Content freshness"
                      hint="No live connection to Anthropic's certification page — this is a manual, reviewed workflow" />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="stat-label">Blueprint version</div>
          <div className="mt-1 text-lg font-semibold text-white">{blueprint.version}</div>
        </div>
        <div>
          <div className="stat-label">Last verified</div>
          <div className="mt-1 text-lg font-semibold text-white">{formatDate(blueprint.freshness.last_verified)}</div>
        </div>
        <div>
          <div className="stat-label">Verified by</div>
          <div className="mt-1 text-lg font-semibold text-white">{blueprint.freshness.verified_by}</div>
        </div>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-ink-400">{blueprint.freshness.note}</p>

      <div className="mt-5">
        <div className="stat-label mb-2">Checklist for the next review</div>
        <ul className="space-y-1.5">
          {blueprint.freshness.checklist.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-ink-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
              {item}
            </li>
          ))}
        </ul>
        <a href={blueprint.freshness.source_url} target="_blank" rel="noreferrer noopener"
           className="btn-ghost btn-sm mt-4">
          Open the certification page ↗
        </a>
      </div>

      <div className="mt-6 border-t border-white/[0.07] pt-6">
        <div className="stat-label mb-3">Record a review</div>
        {message && <div className="mb-3"><Alert tone="mint">{message}</Alert></div>}
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="label" htmlFor="verified-by">Your name</label>
            <input id="verified-by" className="field" value={verifiedBy}
                   onChange={(e) => setVerifiedBy(e.target.value)} placeholder="Who checked" />
          </div>
          <div>
            <label className="label" htmlFor="new-version">New version (optional)</label>
            <input id="new-version" className="field" value={version}
                   onChange={(e) => setVersion(e.target.value)} placeholder={blueprint.version} />
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={markReviewed}>
              {busy ? "Saving…" : "Mark reviewed today"}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
