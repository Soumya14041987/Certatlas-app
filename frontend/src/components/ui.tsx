import { useEffect, useMemo, useState, type ReactNode } from "react";
import { highlight } from "../lib/highlight";
import { renderMarkdown } from "../lib/markdown";
import { TONE_BG, TONE_TEXT, clamp, scoreTone } from "../lib/format";

/* -------------------------------------------------------------------------- */
export function Card({ children, className = "", raised = false }: {
  children: ReactNode; className?: string; raised?: boolean;
}) {
  return <div className={`${raised ? "surface-raised" : "surface"} ${className}`}>{children}</div>;
}

export function SectionHeading({ title, hint, action }: {
  title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "neutral" }: {
  label: string; value: ReactNode; sub?: string;
  tone?: keyof typeof TONE_TEXT;
}) {
  return (
    <Card className="p-5">
      <div className="stat-label">{label}</div>
      <div className={`stat-value mt-2 ${TONE_TEXT[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </Card>
  );
}

export function Meter({ percent, tone, className = "", height = "h-2" }: {
  percent: number; tone?: keyof typeof TONE_BG; className?: string; height?: string;
}) {
  const value = clamp(percent, 0, 100);
  const resolved = tone ?? scoreTone(value);
  return (
    <div className={`w-full overflow-hidden rounded-full bg-white/[0.06] ${height} ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${TONE_BG[resolved]}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, body, action, icon = "◇" }: {
  title: string; body: string; action?: ReactNode; icon?: string;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-xl text-brand-300">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-ink-400">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

export function Alert({ tone = "rose", children }: {
  tone?: "rose" | "amber" | "brand" | "mint"; children: ReactNode;
}) {
  const tones = {
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-500",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    brand: "border-brand-400/30 bg-brand-500/10 text-brand-300",
    mint: "border-mint-400/30 bg-mint-500/10 text-mint-400",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="alert">
      {children}
    </div>
  );
}


/**
 * Question stems and options carry inline `code` spans only, so handle that one
 * markdown case directly rather than running the full pipeline per option.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code
            key={i}
            className="rounded-md border border-white/[0.07] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.86em] text-brand-300"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(code, lang), [code, lang]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <figure className="overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/70">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          {title ?? lang ?? "snippet"}
        </span>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => undefined);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="code-block !rounded-none !border-0">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`prose-sheet ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* -------------------------------------------------------------------------- */
/** Horizontal per-domain accuracy bars — readable at a glance, no chart lib. */
export function DomainBars({ rows, passMark = 72 }: {
  rows: { code: string; name: string; percent: number | null; total?: number; weight?: number }[];
  passMark?: number;
}) {
  return (
    <div className="space-y-3.5">
      {rows.map((row) => {
        const value = row.percent ?? 0;
        const tone = row.percent === null ? "neutral" : scoreTone(value, passMark);
        return (
          <div key={row.code}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-200">
                <span className="mr-2 font-mono text-[11px] text-ink-500">{row.code}</span>
                {row.name}
              </span>
              <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
                {row.percent === null ? "—" : `${value.toFixed(0)}%`}
                {row.total !== undefined && (
                  <span className="ml-1.5 text-[11px] font-normal text-ink-500">({row.total})</span>
                )}
              </span>
            </div>
            <Meter percent={value} tone={tone} height="h-1.5" />
          </div>
        );
      })}
    </div>
  );
}

/** Sparkline of past attempt scores with the pass mark drawn in. */
export function TrendChart({ points, passMark }: {
  points: { score_percent: number; label: string }[]; passMark: number;
}) {
  const width = 640;
  const height = 168;
  const pad = { top: 12, right: 12, bottom: 20, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (points.length === 0) return null;
  const x = (i: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (clamp(v, 0, 100) / 100) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score_percent).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img"
         aria-label={`Score trend across ${points.length} submitted attempts`}>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6d5bf5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6d5bf5" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)}
                stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={pad.left - 8} y={y(tick) + 3.5} textAnchor="end"
                className="fill-ink-500 text-[9px]">{tick}</text>
        </g>
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={y(passMark)} y2={y(passMark)}
            stroke="#34d399" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      <text x={width - pad.right} y={y(passMark) - 5} textAnchor="end"
            className="fill-mint-400 text-[9px]">pass {passMark}%</text>
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke="#8b7bff" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score_percent)} r="3.5"
                fill="#07070c" stroke="#8b7bff" strokeWidth="2">
          <title>{`${p.label}: ${p.score_percent}%`}</title>
        </circle>
      ))}
    </svg>
  );
}
