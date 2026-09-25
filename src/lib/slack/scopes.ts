/**
 * Slack OAuth user-token scopes (https://api.slack.com/scopes) requested by
 * this app, and why each one is needed. Keep this list and docs/slack-app-setup.md
 * in sync — the doc is the source a reader checks before creating the Slack App.
 *
 * We request USER token scopes (not bot token scopes) so the app only ever
 * sees what the authorizing person can already see in Slack — it acts as
 * them, rather than as a separate bot identity added to channels.
 */
export const SLACK_USER_SCOPES = [
  // Read channels/DMs/groups the user is a member of, and their metadata.
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",

  // Read message history in those conversations.
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",

  // Send messages and thread replies as the user.
  "chat:write",

  // Add/remove/view emoji reactions.
  "reactions:read",
  "reactions:write",

  // Resolve member IDs to profile info (name, avatar) for display.
  "users:read",
  "users.profile:read",

  // Download files/images attached to messages.
  "files:read",

  // Search messages the user has access to.
  "search:read",

  // Look up team/workspace metadata (name, domain, icon) shown in the UI.
  "team:read",
] as const;

/**
 * Events this app subscribes to via the Events API, and the scope each
 * requires. Event subscriptions mirror the user scopes above — we only
 * receive events for data the authorizing user could already read.
 */
export const SLACK_EVENT_SUBSCRIPTIONS = [
  { event: "message.channels", requires: "channels:history" },
  { event: "message.groups", requires: "groups:history" },
  { event: "message.im", requires: "im:history" },
  { event: "message.mpim", requires: "mpim:history" },
  { event: "reaction_added", requires: "reactions:read" },
  { event: "reaction_removed", requires: "reactions:read" },
] as const;

export const SLACK_SCOPES_STRING = SLACK_USER_SCOPES.join(",");
