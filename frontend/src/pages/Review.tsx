import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ReviewItem } from "../lib/types";
import { Alert, Card, CodeBlock, InlineCode, Markdown, Spinner } from "../components/ui";
import { DIFFICULTY_LABEL } from "../lib/format";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const onlyIncorrect = params.get("only_incorrect") === "1";

  const [data, setData] = useState<{ label: string; count: number; items: ReviewItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<string>("all");

  useEffect(() => {
    setData(null);
    api.review(Number(id), onlyIncorrect)
      .then((payload) => {
        setData(payload);
        // Wrong answers start expanded — that is the material to read.
        setOpenIds(new Set(payload.items.filter((i) => !i.is_correct).map((i) => i.id)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the review"));
  }, [id, onlyIncorrect]);

  const domains = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.items.map((i) => i.domain))).sort();
  }, [data]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner label="Loading your review" />;

  const items = domainFilter === "all" ? data.items : data.items.filter((i) => i.domain === domainFilter);
  const wrong = data.items.filter((i) => !i.is_correct).length;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Review · {data.label}</h1>
          <p className="page-sub">
            {onlyIncorrect
              ? `${data.count} question${data.count === 1 ? "" : "s"} you got wrong or skipped`
              : `All ${data.count} questions · ${wrong} to work on`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn btn-sm ${onlyIncorrect ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setParams(onlyIncorrect ? {} : { only_incorrect: "1" })}>
            {onlyIncorrect ? "Showing mistakes only" : "Show mistakes only"}
          </button>
          <Link to={`/attempt/${id}/scorecard`} className="btn-ghost btn-sm">Back to scorecard</Link>
        </div>
      </div>

      {domains.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`btn btn-sm ${domainFilter === "all" ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                  onClick={() => setDomainFilter("all")}>
            All domains
          </button>
          {domains.map((code) => (
            <button key={code} type="button"
                    className={`btn btn-sm font-mono ${domainFilter === code ? "bg-white/[0.1] text-white" : "btn-quiet"}`}
                    onClick={() => setDomainFilter(code)}>
              {code}
            </button>
          ))}
          <button type="button" className="btn-quiet btn-sm ml-auto"
                  onClick={() => setOpenIds(openIds.size ? new Set() : new Set(items.map((i) => i.id)))}>
            {openIds.size ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <Card className="px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-500/15 text-xl text-mint-400">✓</div>
          <h3 className="text-base font-semibold text-white">Nothing to review here</h3>
          <p className="mt-2 text-sm text-ink-400">
            {onlyIncorrect ? "You answered every question on this paper correctly." : "No questions match that filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              open={openIds.has(item.id)}
              onToggle={() =>
                setOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item, open, onToggle }: { item: ReviewItem; open: boolean; onToggle: () => void }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const correctSet = new Set(item.correct);
  const selectedSet = new Set(item.selected);

  return (
    <Card className={item.is_correct ? "" : "border-rose-500/20"}>
      <button type="button" onClick={onToggle} aria-expanded={open}
              className="flex w-full items-start gap-4 px-5 py-4 text-left">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
          item.is_correct ? "bg-mint-500/15 text-mint-400"
            : item.answered ? "bg-rose-500/15 text-rose-500"
            : "bg-white/[0.07] text-ink-400"
        }`}>
          {item.is_correct ? "✓" : item.answered ? "✕" : "–"}
        </span>
        <span className="min-w-0 grow">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-ink-500">
              Q{item.position} · {item.domain}
            </span>
            <span className="chip-neutral">{DIFFICULTY_LABEL[item.difficulty]}</span>
            {!item.answered && <span className="chip-amber">Skipped</span>}
            {item.flagged && <span className="chip-amber">Flagged</span>}
          </span>
          <span className={`mt-2 block text-[14.5px] leading-relaxed ${open ? "text-white" : "line-clamp-2 text-ink-200"}`}>
            <InlineCode text={item.stem} />
          </span>
        </span>
        <span className="mt-1 shrink-0 text-ink-500">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="space-y-6 border-t border-white/[0.07] px-5 py-6">
          {/* Options with the answer key applied. */}
          <div className="space-y-2">
            {item.options.map((option) => {
              const isCorrect = correctSet.has(option.key);
              const wasChosen = selectedSet.has(option.key);
              const note = item.distractor_notes[option.key];
              return (
                <div key={option.key}
                     className={`rounded-xl border px-4 py-3 ${
                       isCorrect ? "border-mint-400/40 bg-mint-500/[0.08]"
                         : wasChosen ? "border-rose-500/40 bg-rose-500/[0.08]"
                         : "border-white/[0.06] bg-white/[0.02]"
                     }`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                      isCorrect ? "bg-mint-500 text-ink-950"
                        : wasChosen ? "bg-rose-500 text-white"
                        : "bg-white/[0.07] text-ink-400"
                    }`}>
                      {option.key}
                    </span>
                    <div className="min-w-0 grow">
                      <div className="text-[14px] leading-relaxed text-ink-100"><InlineCode text={option.text} /></div>
                      {note && !isCorrect && (
                        <div className="mt-2 text-[13px] leading-relaxed text-ink-400">
                          <span className="font-semibold text-rose-500">Why not: </span><InlineCode text={note} />
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 self-start text-[10px] font-semibold uppercase tracking-wider">
                      {isCorrect && <span className="text-mint-400">correct</span>}
                      {!isCorrect && wasChosen && <span className="text-rose-500">your answer</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <section>
            <h4 className="stat-label mb-2">Why</h4>
            <p className="text-[14.5px] leading-relaxed text-ink-200"><InlineCode text={item.explanation} /></p>
          </section>

          {item.analogy && (
            <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4">
              <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-400">
                <span>◇</span> Think of it like · {item.analogy.frame}
              </h4>
              <p className="text-[14px] leading-relaxed text-ink-200"><InlineCode text={item.analogy.text} /></p>
            </section>
          )}

          {item.snippet && (
            <section>
              <h4 className="stat-label mb-2">In code</h4>
              <CodeBlock code={item.snippet.code} lang={item.snippet.lang} title={item.snippet.title} />
            </section>
          )}

          {item.diagram && (
            <section>
              <h4 className="stat-label mb-2">Diagram</h4>
              <pre className="code-block whitespace-pre">{item.diagram}</pre>
            </section>
          )}

          {item.cheatsheet_content && (
            <section className="rounded-xl border border-brand-400/25 bg-brand-500/[0.06] p-4">
              <button type="button" onClick={() => setSheetOpen((v) => !v)} aria-expanded={sheetOpen}
                      className="flex w-full items-center justify-between gap-3 text-left">
                <span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">
                    Cheat sheet
                  </span>
                  <span className="mt-1 block text-sm font-medium text-white">
                    {item.cheatsheet_content.title}
                    {item.cheatsheet_content.anchor && (
                      <span className="ml-2 font-mono text-xs text-ink-400">
                        #{item.cheatsheet_content.anchor}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-ink-400">{sheetOpen ? "▴" : "▾"}</span>
              </button>

              {sheetOpen && (
                <div className="mt-4 border-t border-white/[0.07] pt-4">
                  <Markdown source={item.cheatsheet_content.section ?? item.cheatsheet_content.body} />
                  <Link to={`/cheatsheets/${item.cheatsheet_content.slug}`} className="btn-ghost btn-sm mt-4">
                    Open the full sheet
                  </Link>
                </div>
              )}
            </section>
          )}

          {item.objective && (
            <p className="border-t border-white/[0.05] pt-4 text-[11px] text-ink-500">
              Blueprint objective: <span className="text-ink-400">{item.objective}</span>
              {item.tags.length > 0 && <> · {item.tags.join(" · ")}</>}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
