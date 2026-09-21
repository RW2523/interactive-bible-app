import DOMPurify from "dompurify";

// AI-polished sermon HTML originates from user-uploaded documents and
// transcripts, so it must be treated as untrusted before rendering (share
// page, previews). DOMPurify runs in the browser; the allow-list mirrors the
// conservative sanitize-html defaults the original app used, plus img/h1/h2.
const ALLOWED_TAGS = [
  "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "main", "nav", "section",
  "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "hr", "li", "ol", "p", "pre", "ul",
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc",
  "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "img",
];
const ALLOWED_ATTR = ["href", "name", "target", "src", "alt"];
// http(s) and mailto links only, plus relative URLs (e.g. same-origin /v1/files/… images).
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target")) node.setAttribute("rel", "noopener noreferrer");
  });
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  ensureHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR, "rel"],
    ALLOWED_URI_REGEXP,
  });
}

// The single HTML/SVG escaper for the feature — full quote-escaping so it is
// safe in both text-content and attribute positions. Coerces non-strings (SVG
// builders pass numbers). structured.ts and visuals/svg.ts both import this.
export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
