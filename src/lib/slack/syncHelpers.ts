// Pure helpers for the Slack sync — no database or network access, so they can be unit tested and
// (for tsBefore/isRootMessage) shared with client components.

/** The fields of a Slack message payload (history, replies or an event) that the sync reads. */
export interface SlackMessagePayload {
  ts?: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  edited?: { ts?: string; user?: string };
  reply_count?: number;
  latest_reply?: string;
  reactions?: { name?: string; users?: string[]; count?: number }[];
  files?: { id?: string }[];
  attachments?: unknown[];
  [key: string]: unknown;
}

const MENTION_RE = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Every Slack user id mentioned as `<@U123>` in a message's text. */
export function mentionedUserIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) ids.add(match[1]);
  return [...ids];
}

/** A root (top-level) message: Slack sets thread_ts only on threaded messages, and on a thread's root it equals ts. */
export function isRootMessage(m: { slackTs: string; threadTs: string | null }): boolean {
  return !m.threadTs || m.threadTs === m.slackTs;
}

/** The newest root message's ts — what a channel-level read cursor should point at (Slack's cursor ignores thread replies). */
export function newestRootTs(messages: { slackTs: string; threadTs: string | null }[]): string | null {
  let newest: string | null = null;
  for (const m of messages) {
    if (isRootMessage(m) && (newest === null || m.slackTs > newest)) newest = m.slackTs;
  }
  return newest;
}

/**
 * The parts of a message that, when Slack reports them differently from the cached copy, mean the
 * cache needs rewriting: text, an edit, thread activity, attachments. Compared instead of the whole
 * raw payload because Postgres stores it as jsonb, which doesn't keep key order.
 */
export function messageFingerprint(m: SlackMessagePayload | null | undefined): string {
  if (!m) return "";
  return JSON.stringify([
    m.text ?? "",
    m.edited?.ts ?? "",
    m.subtype ?? "",
    m.reply_count ?? 0,
    m.latest_reply ?? "",
    (m.files ?? []).map((f) => f.id ?? ""),
    (m.attachments ?? []).length,
  ]);
}

export interface ReactionKey {
  messageId: string;
  emoji: string;
  slackUserId: string;
}

/**
 * Works out which cached reaction rows to add and remove so they match what Slack reports.
 * `partial` lists `messageId|emoji` pairs whose user list Slack truncated (users.length < count);
 * those are only ever added to, never pruned, since an absent user may just be past the cut-off.
 */
export function diffReactions<T extends ReactionKey>(
  current: T[],
  desired: ReactionKey[],
  partial: Set<string> = new Set()
): { toAdd: ReactionKey[]; toRemove: T[] } {
  const key = (r: ReactionKey) => `${r.messageId}|${r.emoji}|${r.slackUserId}`;
  const desiredKeys = new Set(desired.map(key));
  const currentKeys = new Set(current.map(key));
  const added = new Set<string>();
  const toAdd: ReactionKey[] = [];
  for (const r of desired) {
    const k = key(r);
    if (currentKeys.has(k) || added.has(k)) continue;
    added.add(k);
    toAdd.push(r);
  }
  const toRemove = current.filter((r) => !desiredKeys.has(key(r)) && !partial.has(`${r.messageId}|${r.emoji}`));
  return { toAdd, toRemove };
}

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving nothing but completion. */
export async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * The Slack timestamp one microsecond before `ts` — a cursor that sits just ahead of a message, for
 * "mark unread from here" on the very first message (where there's no previous message to point at).
 */
export function tsBefore(ts: string): string {
  const [seconds, micros = "0"] = ts.split(".");
  const total = BigInt(seconds) * BigInt(1_000_000) + BigInt(micros.padEnd(6, "0").slice(0, 6)) - BigInt(1);
  const clamped = total < BigInt(0) ? BigInt(0) : total;
  const whole = clamped / BigInt(1_000_000);
  const frac = clamped % BigInt(1_000_000);
  return `${whole.toString().padStart(10, "0")}.${frac.toString().padStart(6, "0")}`;
}

/** Slack's `ts` as a Date (second precision is all the UI needs). */
export function tsToDate(slackTs: string): Date {
  return new Date(Number(slackTs.split(".")[0]) * 1000);
}

/**
 * Message text as plain words for a push notification: `<@U123>` becomes `@Name`, links show their
 * label, channel refs their name, and Slack's HTML escaping is undone.
 */
export function slackTextToPlain(text: string, userNames: Record<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, label?: string) => `@${userNames[id] ?? label ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_, word: string) => `@${word}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, _url: string, label: string) => label)
    .replace(/<(https?:\/\/[^>]+)>/g, (_, url: string) => url)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
