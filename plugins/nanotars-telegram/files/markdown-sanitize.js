/**
 * Sanitize outbound text for Telegram's legacy `Markdown` parse mode.
 *
 * Telegram's legacy Markdown parser is strict and brittle: it rejects
 * `**bold**` (CommonMark), unbalanced `*` / `_` delimiters, and unmatched
 * `[ ]`. Sending such text with `parse_mode: 'Markdown'` causes the API call
 * to fail outright. Without sanitisation, the safe choice is to send raw
 * text — but then `**bold**` from the assistant renders literally.
 *
 * This sanitiser:
 *   - protects fenced and inline code spans (their contents stay verbatim);
 *   - rewrites list bullets (`- item` / `+ item`) to `• item` so they don't
 *     get re-emitted as `* item` (which would unbalance the asterisk count);
 *   - flattens horizontal rules (`---`/`***`/`___`) to a unicode divider;
 *   - downgrades CommonMark `**bold**` and `__under__` to legacy `*bold*` /
 *     `_under_`;
 *   - strips orphan `*` / `_` if the delimiter count is odd;
 *   - strips `[ ]` if open/close counts don't match.
 *
 * Ported verbatim from nanoclaw v2's
 * `src/channels/telegram-markdown-sanitize.ts`.
 */

const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;
const PLACEHOLDER_PREFIX = '\x00CODE';
const PLACEHOLDER_SUFFIX = '\x00';

export function sanitizeTelegramLegacyMarkdown(input) {
  if (!input) return input;

  const codeSegments = [];
  let text = input.replace(CODE_PATTERN, (m) => {
    codeSegments.push(m);
    return `${PLACEHOLDER_PREFIX}${codeSegments.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  // List bullets `- ` / `+ ` → `• ` so the parser sees prose, not a stray `*`.
  text = text.replace(/^(\s*)[-+]\s+/gm, '$1• ');

  // Markdown horizontal rules → unicode divider (parser doesn't understand HR
  // syntax and the bare `*` / `_` would unbalance the delimiter counts below).
  text = text.replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, '⎯⎯⎯');

  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
  text = text.replace(/__([^_\n]+?)__/g, '_$1_');

  const starCount = (text.match(/\*/g) ?? []).length;
  const underCount = (text.match(/_/g) ?? []).length;
  if (starCount % 2 !== 0 || underCount % 2 !== 0) {
    text = text.replace(/[*_]/g, '');
  }

  const openBrackets = (text.match(/\[/g) ?? []).length;
  const closeBrackets = (text.match(/\]/g) ?? []).length;
  if (openBrackets !== closeBrackets) {
    text = text.replace(/[[\]]/g, '');
  }

  return text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (_, i) => codeSegments[Number(i)],
  );
}
