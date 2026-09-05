import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CheatSheetPayload } from "../lib/types";
import { Alert, Card, Markdown, Spinner } from "../components/ui";
import { slugify } from "../lib/markdown";

type Index = Pick<CheatSheetPayload, "slug" | "domain" | "title" | "summary" | "anchors">;

export default function CheatSheets() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const [index, setIndex] = useState<Index[] | null>(null);
  const [sheet, setSheet] = useState<CheatSheetPayload | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cheatsheets().then(setIndex).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load the cheat sheets"));
  }, []);

  useEffect(() => {
    if (!slug) { setSheet(null); return; }
    setSheet(null);
    api.cheatsheet(slug).then(setSheet).catch((err) =>
      setError(err instanceof Error ? err.message : "No such cheat sheet"));
  }, [slug]);

  const filtered = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    if (!q) return index;
    return index.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.anchors.some((a) => a.toLowerCase().includes(q)));
  }, [index, query]);

  if (error) return <Alert>{error}</Alert>;
  if (!index) return <Spinner label="Loading cheat sheets" />;

  return (
    <div className="animate-rise">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Cheat sheets</h1>
          <p className="page-sub">
            One condensed reference per domain — the same sections that get inlined
            beside every answer you get wrong.
          </p>
        </div>
        <input className="field w-full sm:w-72" placeholder="Search sheets and sections…"
               value={query} onChange={(event) => setQuery(event.target.value)}
               aria-label="Search cheat sheets" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="space-y-1.5">
            {filtered.map((item) => (
              <button key={item.slug} type="button" onClick={() => navigate(`/cheatsheets/${item.slug}`)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        slug === item.slug
                          ? "border-brand-400/40 bg-brand-500/[0.12]"
                          : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]"
                      }`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-500">{item.domain}</span>
                  <span className="text-[11px] text-ink-600">{item.anchors.length} sections</span>
                </div>
                <div className="mt-1 text-[13px] font-medium leading-snug text-white">{item.title}</div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-sm text-ink-500">Nothing matches “{query}”.</p>
            )}
          </nav>
        </aside>

        <div>
          {!slug ? (
            <Card className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-xl text-brand-300">❑</div>
              <h3 className="text-base font-semibold text-white">Pick a sheet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-400">
                Each one distils a blueprint domain into tables, rules and worked examples —
                written to be re-read the morning of the exam.
              </p>
            </Card>
          ) : !sheet ? (
            <Spinner label="Loading sheet" />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1fr_190px]">
              <Card className="p-7">
                <div className="mb-6 border-b border-white/[0.07] pb-5">
                  <span className="chip-brand font-mono">{sheet.domain}</span>
                  <h2 className="mt-3 text-xl font-bold tracking-tight text-white">{sheet.title}</h2>
                  <p className="mt-1.5 text-sm text-ink-400">{sheet.summary}</p>
                </div>
                <Markdown source={sheet.body} />
              </Card>

              <nav className="hidden xl:sticky xl:top-24 xl:block xl:self-start">
                <div className="stat-label mb-3">On this page</div>
                <ul className="space-y-1.5 border-l border-white/[0.07] pl-3">
                  {sheet.anchors.map((anchor) => (
                    <li key={anchor}>
                      <Link to={`#${slugify(anchor)}`}
                            className="block truncate font-mono text-[11px] text-ink-400 transition-colors hover:text-brand-300">
                        {anchor}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
