// Slack's `ts` is the moment Slack accepted the message — the same instant for the sender's
// "sent" and the recipient's "delivered" — so it's what every timestamp in the UI shows. It's
// preferred over Message.createdAt, which is only when this app's cache row was written (a backfill
// would stamp a whole channel's history with the sync time).

export function messageDate(slackTs: string): Date {
  return new Date(Number(slackTs.split(".")[0]) * 1000);
}

/** 24-hour clock, e.g. "14:32". */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Full timestamp for tooltips, e.g. "Sat 27 Sept 2026, 14:32". */
export function formatFullDateTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Local calendar day, for grouping messages under a date divider. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Divider label, e.g. "Saturday 27 September 2026". */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
