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

  // Pin/unpin messages from within the app.
  "pins:write",

  // Set custom status text/emoji.
  "users.profile:write",

  // Set active/away presence.
  "users:write",

  // Turn Do Not Disturb on/off.
  "dnd:write",

  // Resolve member IDs to profile info (name, avatar) for display.
  "users:read",
  "users.profile:read",

  // Download files/images attached to messages.
  "files:read",

  // Upload files and voice notes as attachments.
  "files:write",

  // "Remind me about this" from a message's menu.
  "reminders:write",

  // Render the workspace's custom emoji (emoji.list).
  "emoji:read",

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

/**
 * The write scope conversations.mark needs for each kind of conversation — i.e. what it takes for
 * reading a conversation *here* to clear it in Slack's own apps. Optional (requested only via
 * SLACK_EXTRA_USER_SCOPES), so callers check the installation's granted scopes before trying.
 */
export const READ_MARK_SCOPES = {
  PUBLIC_CHANNEL: "channels:write",
  PRIVATE_CHANNEL: "groups:write",
  DM: "im:write",
  GROUP_DM: "mpim:write",
} as const;

export function hasScope(grantedScopes: string, scope: string): boolean {
  return grantedScopes.split(/[\s,]+/).includes(scope);
}

/** Whether conversations.mark can be used for this kind of conversation with these granted scopes. */
export function canMarkReadInSlack(grantedScopes: string, type: keyof typeof READ_MARK_SCOPES): boolean {
  return hasScope(grantedScopes, READ_MARK_SCOPES[type]);
}
