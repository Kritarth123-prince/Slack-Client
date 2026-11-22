import { describe, expect, it } from "vitest";
import { emojiNameForGlyph, toSlackEmojiCode } from "@/lib/ui/emoji";
import { canMarkReadInSlack, hasScope } from "@/lib/slack/scopes";

describe("toSlackEmojiCode", () => {
  it("passes shortcodes through in Slack's :name: form", () => {
    expect(toSlackEmojiCode(":palm_tree:")).toBe(":palm_tree:");
    expect(toSlackEmojiCode("palm_tree")).toBe(":palm_tree:");
    expect(toSlackEmojiCode(":+1:")).toBe(":+1:");
  });

  it("converts a glyph to its shortcode (Slack rejects raw glyphs)", () => {
    expect(toSlackEmojiCode("🌴")).toBe(":palm_tree:");
    expect(toSlackEmojiCode("🏠")).toBe(":house:");
  });

  it("matches glyphs with or without the variation selector", () => {
    expect(emojiNameForGlyph("✈")).toBe("airplane");
    expect(emojiNameForGlyph("✈️")).toBe("airplane");
  });

  it("returns empty for nothing, or for something Slack couldn't accept", () => {
    expect(toSlackEmojiCode(null)).toBe("");
    expect(toSlackEmojiCode("  ")).toBe("");
    expect(toSlackEmojiCode("not an emoji!")).toBe("");
  });
});

describe("read-sync scopes", () => {
  it("reads granted scopes in either separator style", () => {
    expect(hasScope("channels:read,im:write", "im:write")).toBe(true);
    expect(hasScope("channels:read im:write", "im:write")).toBe(true);
    expect(hasScope("channels:read im:writer", "im:write")).toBe(false);
  });

  it("needs the write scope that matches the conversation type", () => {
    const scopes = "channels:history im:write";
    expect(canMarkReadInSlack(scopes, "DM")).toBe(true);
    expect(canMarkReadInSlack(scopes, "PUBLIC_CHANNEL")).toBe(false);
    expect(canMarkReadInSlack(scopes, "GROUP_DM")).toBe(false);
  });
});
