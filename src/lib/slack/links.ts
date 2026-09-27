// Slack wraps links as <https://example.com|label> (label optional); bare URLs also appear in
// text posted from this app. Either way, only the first one is previewed.
const SLACK_LINK_RE = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/;
const BARE_URL_RE = /https?:\/\/[^\s<>()]+/;

/** The first http(s) URL in a message's text, or null. */
export function firstLinkIn(text: string): string | null {
  const wrapped = text.match(SLACK_LINK_RE)?.[1];
  if (wrapped) return wrapped;
  const bare = text.match(BARE_URL_RE)?.[0];
  return bare ? bare.replace(/[.,;:!?]+$/, "") : null;
}
