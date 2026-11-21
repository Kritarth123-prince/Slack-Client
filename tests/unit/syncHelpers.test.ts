import { describe, expect, it } from "vitest";
import {
  diffReactions,
  isRootMessage,
  mapWithConcurrency,
  mentionedUserIds,
  messageFingerprint,
  newestRootTs,
  slackTextToPlain,
  tsBefore,
} from "@/lib/slack/syncHelpers";

describe("mentionedUserIds", () => {
  it("finds each mentioned user once, with or without a label", () => {
    expect(mentionedUserIds("hi <@U1> and <@U2|bob>, also <@U1>")).toEqual(["U1", "U2"]);
  });

  it("ignores channel refs and broadcasts", () => {
    expect(mentionedUserIds("<#C1|general> <!here>")).toEqual([]);
  });
});

describe("root messages", () => {
  it("treats no thread_ts, or thread_ts equal to ts, as a root", () => {
    expect(isRootMessage({ slackTs: "1.1", threadTs: null })).toBe(true);
    expect(isRootMessage({ slackTs: "1.1", threadTs: "1.1" })).toBe(true);
    expect(isRootMessage({ slackTs: "1.2", threadTs: "1.1" })).toBe(false);
  });

  it("points the read cursor at the newest root, never a newer reply", () => {
    const messages = [
      { slackTs: "1700000001.000000", threadTs: null },
      { slackTs: "1700000002.000000", threadTs: "1700000002.000000" },
      { slackTs: "1700000009.000000", threadTs: "1700000001.000000" },
    ];
    expect(newestRootTs(messages)).toBe("1700000002.000000");
    expect(newestRootTs([])).toBeNull();
  });
});

describe("messageFingerprint", () => {
  it("is stable regardless of key order (jsonb doesn't keep it)", () => {
    const a = { text: "hi", ts: "1", reply_count: 2, edited: { ts: "5" } };
    const b = { edited: { ts: "5" }, reply_count: 2, ts: "1", text: "hi" };
    expect(messageFingerprint(a)).toBe(messageFingerprint(b));
  });

  it("changes on an edit, new replies or new files", () => {
    const base = { text: "hi" };
    expect(messageFingerprint(base)).not.toBe(messageFingerprint({ text: "hi", edited: { ts: "9" } }));
    expect(messageFingerprint(base)).not.toBe(messageFingerprint({ text: "hi", reply_count: 1 }));
    expect(messageFingerprint(base)).not.toBe(messageFingerprint({ text: "hi", files: [{ id: "F1" }] }));
  });

  it("ignores fields that don't affect what's shown", () => {
    expect(messageFingerprint({ text: "hi" })).toBe(messageFingerprint({ text: "hi", client_msg_id: "x", team: "T1" }));
  });
});

describe("diffReactions", () => {
  const row = (id: string, messageId: string, emoji: string, slackUserId: string) => ({ id, messageId, emoji, slackUserId });

  it("adds what Slack has and removes what it no longer has", () => {
    const current = [row("r1", "m1", "+1", "u1"), row("r2", "m1", "eyes", "u2")];
    const desired = [
      { messageId: "m1", emoji: "+1", slackUserId: "u1" },
      { messageId: "m1", emoji: "tada", slackUserId: "u3" },
    ];
    const { toAdd, toRemove } = diffReactions(current, desired);
    expect(toAdd).toEqual([{ messageId: "m1", emoji: "tada", slackUserId: "u3" }]);
    expect(toRemove.map((r) => r.id)).toEqual(["r2"]);
  });

  it("never prunes a reaction whose user list Slack truncated", () => {
    const current = [row("r1", "m1", "+1", "u9")];
    const { toRemove } = diffReactions(current, [], new Set(["m1|+1"]));
    expect(toRemove).toEqual([]);
  });

  it("doesn't add the same reaction twice", () => {
    const desired = [
      { messageId: "m1", emoji: "+1", slackUserId: "u1" },
      { messageId: "m1", emoji: "+1", slackUserId: "u1" },
    ];
    expect(diffReactions([], desired).toAdd).toHaveLength(1);
  });
});

describe("tsBefore", () => {
  it("is one microsecond earlier", () => {
    expect(tsBefore("1700000000.123456")).toBe("1700000000.123455");
  });

  it("borrows across the decimal point", () => {
    expect(tsBefore("1700000000.000000")).toBe("1699999999.999999");
  });

  it("sorts just before the original, as Slack ts strings are compared", () => {
    const ts = "1700000000.500000";
    expect(tsBefore(ts) < ts).toBe(true);
  });
});

describe("slackTextToPlain", () => {
  it("turns Slack markup into readable notification text", () => {
    const text = "<@U1> see <https://example.com|the doc> in <#C1|general> &amp; <!here> &lt;3";
    expect(slackTextToPlain(text, { U1: "Asha" })).toBe("@Asha see the doc in #general & @here <3");
  });

  it("falls back to the mention's label or id", () => {
    expect(slackTextToPlain("<@U2|sam> <@U3>", {})).toBe("@sam @U3");
  });
});

describe("mapWithConcurrency", () => {
  it("runs everything, never more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      running--;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("copes with an empty list", async () => {
    await expect(mapWithConcurrency([], 3, async () => {})).resolves.toBeUndefined();
  });
});
