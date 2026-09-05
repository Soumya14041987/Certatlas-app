/**
 * A deliberately small syntax highlighter.
 *
 * Question snippets are short and come from a fixed set of languages, so a
 * ~70-line tokeniser produces the same visual result as a 200 kB dependency
 * without shipping one. Input is escaped before any markup is inserted.
 */
type Lang = "json" | "bash" | "python" | "yaml" | "markdown" | "text";

const KEYWORDS: Record<string, string[]> = {
  python: ["import", "from", "def", "async", "await", "return", "class", "if", "else",
    "elif", "for", "while", "with", "as", "try", "except", "raise", "not", "in", "is",
    "and", "or", "None", "True", "False", "lambda", "yield", "pass"],
  bash: ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "case", "esac",
    "while", "function", "export", "echo", "exit", "local", "return"],
  json: ["true", "false", "null"],
  yaml: ["true", "false", "null", "on", "off"],
  markdown: [],
  text: [],
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function normaliseLang(lang: string | undefined): Lang {
  const l = (lang ?? "").toLowerCase();
  if (l === "json") return "json";
  if (l === "bash" || l === "sh" || l === "shell" || l === "zsh") return "bash";
  if (l === "python" || l === "py") return "python";
  if (l === "yaml" || l === "yml") return "yaml";
  if (l === "markdown" || l === "md") return "markdown";
  return "text";
}

/** Returns HTML with `tok-*` spans. The input is escaped first. */
export function highlight(code: string, langInput?: string): string {
  const lang = normaliseLang(langInput);
  const keywords = KEYWORDS[lang] ?? [];

  // One pass, alternation-ordered so strings and comments win over keywords.
  const pattern = new RegExp(
    [
      String.raw`(?<com>#[^\n]*|//[^\n]*)`,
      String.raw`(?<str>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`,
      String.raw`(?<key>^\s*[-\w.]+(?=\s*:))`,
      String.raw`(?<num>\b\d+(?:\.\d+)?\b)`,
      String.raw`(?<fn>\b[A-Za-z_][\w.]*(?=\())`,
      String.raw`(?<word>\b[A-Za-z_][\w]*\b)`,
    ].join("|"),
    "gm",
  );

  let out = "";
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += escapeHtml(code.slice(last, index));
    const groups = match.groups ?? {};
    const text = escapeHtml(match[0]);

    if (groups.com) out += `<span class="tok-com">${text}</span>`;
    else if (groups.str) out += `<span class="tok-str">${text}</span>`;
    else if (groups.key) out += `<span class="tok-key">${text}</span>`;
    else if (groups.num) out += `<span class="tok-num">${text}</span>`;
    else if (groups.fn) out += `<span class="tok-fn">${text}</span>`;
    else if (groups.word && keywords.includes(match[0])) out += `<span class="tok-kw">${text}</span>`;
    else out += text;

    last = index + match[0].length;
  }
  return out + escapeHtml(code.slice(last));
}
