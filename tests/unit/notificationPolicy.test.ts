import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  pref: null as Record<string, unknown> | null,
  muted: false,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userPreference: { findUnique: async () => db.pref },
    conversationSetting: { findUnique: async () => ({ muted: db.muted }) },
  },
}));

const { notificationAllowed } = await import("@/lib/push");

const defaults = {
  doNotDisturb: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: null,
  notifyDirectMessages: true,
  notifyMentions: true,
  notifyThreadReplies: true,
  notifyChannelMessages: false,
};

const base = {
  conversationId: "c1",
  conversationType: "PUBLIC_CHANNEL" as const,
  text: "hello",
  selfSlackUserId: "UME",
  isThreadReply: false,
};

describe("notificationAllowed", () => {
  beforeEach(() => {
    db.pref = { ...defaults };
    db.muted = false;
  });

  it("notifies for DMs but not ordinary channel chatter by default", async () => {
    expect(await notificationAllowed("u", { ...base, conversationType: "DM" })).toBe(true);
    expect(await notificationAllowed("u", base)).toBe(false);
  });

  it("lets a mention through in a channel", async () => {
    expect(await notificationAllowed("u", { ...base, text: "hey <@UME>" })).toBe(true);
  });

  it("only notifies channel thread replies for threads you're part of", async () => {
    expect(await notificationAllowed("u", { ...base, isThreadReply: true, inThread: false })).toBe(false);
    expect(await notificationAllowed("u", { ...base, isThreadReply: true, inThread: true })).toBe(true);
  });

  it("always counts thread replies in a DM", async () => {
    expect(await notificationAllowed("u", { ...base, conversationType: "DM", isThreadReply: true })).toBe(true);
  });

  it("respects the thread-replies toggle", async () => {
    db.pref = { ...defaults, notifyThreadReplies: false };
    expect(await notificationAllowed("u", { ...base, isThreadReply: true, inThread: true })).toBe(false);
  });

  it("stays silent for muted conversations and Do Not Disturb", async () => {
    db.muted = true;
    expect(await notificationAllowed("u", { ...base, conversationType: "DM" })).toBe(false);
    db.muted = false;
    db.pref = { ...defaults, doNotDisturb: true };
    expect(await notificationAllowed("u", { ...base, conversationType: "DM" })).toBe(false);
  });
});
