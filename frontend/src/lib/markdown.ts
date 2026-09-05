import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/** Render trusted-but-sanitised markdown from the content bank. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "code",
      "pre", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "a",
      "hr", "br", "del", "span",
    ],
    ALLOWED_ATTR: ["href", "title", "class", "id"],
    ALLOW_DATA_ATTR: false,
  });
}

/** GitHub-style slug, matching the ids marked assigns to headings. */
export const slugify = (text: string) =>
  text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
