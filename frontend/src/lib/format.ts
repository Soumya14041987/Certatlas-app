export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const value = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const value = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function scoreTone(percent: number | null | undefined, passMark = 72) {
  if (percent === null || percent === undefined) return "neutral" as const;
  if (percent >= passMark + 8) return "mint" as const;
  if (percent >= passMark) return "brand" as const;
  if (percent >= passMark - 12) return "amber" as const;
  return "rose" as const;
}

export const TONE_TEXT = {
  mint: "text-mint-400", brand: "text-brand-300", amber: "text-amber-500",
  rose: "text-rose-500", neutral: "text-ink-300",
} as const;

export const TONE_BG = {
  mint: "bg-mint-500", brand: "bg-brand-500", amber: "bg-amber-500",
  rose: "bg-rose-500", neutral: "bg-ink-600",
} as const;

export const TONE_CHIP = {
  mint: "chip-mint", brand: "chip-brand", amber: "chip-amber",
  rose: "chip-rose", neutral: "chip-neutral",
} as const;

export const DIFFICULTY_LABEL = {
  foundational: "Foundational", applied: "Applied", architect: "Architect",
} as const;
