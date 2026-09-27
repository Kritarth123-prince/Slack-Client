# Technical overview

This document explains how the app is built: the sync model, data model, security decisions, and how each feature is implemented. For what the app does and how to run it, see [`README.md`](./README.md).

## 1. Architecture at a glance

```
 Slack (real workspace)
   │  OAuth (user token) ── one-time authorization
   │  Events API (webhook, push)         Web API (REST, pull)
   ▼                                          ▲
┌───────────────────────────────────────────────────────┐
│                    Next.js server                     │
│  /api/slack/events  ──▶ processSlackEvent ──▶ Postgres│
│  /api/conversations/* ──▶ syncMessages/postMessage ────│
│                                          (Prisma)      │
└───────────────────────────────────────────────────────┘
   ▲ polls every 4s + on tab focus
   │
 Browser (React Server + Client Components)
```

Postgres is a **local mirror** of whatever the authorizing user can already see in Slack — it is never a second source of truth. Every write path (send, edit, delete, react, pin, upload) calls Slack's API first and only reflects the change locally after Slack accepts it.

There are two independent update paths, which is why the app feels close to real-time despite not holding a persistent connection to the browser:

1. **Slack → server (push).** Slack calls `POST /api/slack/events` for every message/reaction event in real time. The signature is verified (`verifySlackSignature`), the delivery is deduplicated against the `ProcessedSlackEvent` table (Slack retries deliveries, so the same `event_id` can arrive more than once), and `processSlackEvent` writes the change straight into Postgres.
2. **Server → browser (poll).** The open conversation polls `GET /api/conversations/:id/messages` every 4 seconds, and immediately on `visibilitychange` (so backgrounding/foregrounding the tab doesn't leave you stale for up to 4s). A separate, unconditional 15s interval hits `GET /api/conversations` to drive unread badges and push notifications for *other* conversations, independent of which one is open.

Because path 1 is push, the typical end-to-end latency for a new message from a teammate is "however fast Slack calls the webhook," not "up to 4 seconds" — the poll is what turns that server-side write into a UI update, not what detects the message in the first place.

## 2. Data model

Defined in [`prisma/schema.prisma`](./prisma/schema.prisma).

| Model | Purpose |
|---|---|
| `User` | One row per person who has connected a Slack account here. |
| `Session` | Server-side session backing the HttpOnly cookie — revocable independently of cookie lifetime. |
| `SlackInstallation` | The encrypted OAuth token for one `(workspace, Slack user)` pair, plus granted scopes. |
| `Workspace` | Cached Slack team metadata (name, domain, icon). |
| `SlackUser` | Cached profile info for anyone referenced by a message/conversation — populated lazily. |
| `Conversation` | A synced channel/DM/group DM, with a pagination cursor (`lastSyncedCursor`) for incremental history sync. |
| `ConversationMember` | Join table: who's in a conversation. |
| `Message` | A Slack message. `threadTs == slackTs` for a root message; replies point `threadTs` at the parent. No separate `Thread` table — reply counts are derived with a query, so there's nothing to keep in sync. `raw` keeps the full Slack payload (files, blocks) for anything not modeled explicitly. |
| `SavedMessage` | Per-user "save for later" bookmark — a join table, not a flag on `Message`, since saves are personal. |
| `Reaction` | One row per `(message, emoji, user)`. |
| `ReadState` | Per-user, per-conversation last-read `slackTs` — the whole unread/badge system is a comparison against this, not a re-fetch from Slack. |
| `NotificationSubscription` | A browser's Web Push subscription (endpoint + keys). |
| `UserPreference` | Theme, density, per-category notification toggles, quiet hours, presence/status, Do Not Disturb. Mostly **not yet exposed in the UI** — see §7. |
| `ProcessedSlackEvent` | Dedup table keyed by Slack's `event_id`, so a retried webhook delivery is a no-op. |

## 3. Auth & security

- **OAuth scopes are user-token scopes, not bot scopes** (`src/lib/slack/scopes.ts`). The app authenticates *as the person who signed in*, not as a separate bot identity added to their channels — it only ever sees what they could already see in Slack's own client.
- **Tokens are encrypted at rest**: AES-256-GCM (`src/lib/slack/tokenCipher.ts`), key from `TOKEN_ENCRYPTION_KEY`. The decrypted token lives only in server process memory for the duration of a single request (`getSlackClientForUser`) — it's never logged or sent to the browser.
- **Sessions are cookie + DB-backed**: `iron-session` encrypts an HttpOnly cookie containing a session record id; the actual validity check (`requireUserId`) looks up that row in Postgres, so a session can be revoked server-side (logout, token revocation) without waiting for the cookie to expire.
- **Inbound Slack webhooks are signature-verified** (`verifySlackSignature`) against `SLACK_SIGNING_SECRET` before the body is even parsed.
- **`callSlack()`** wraps every Slack API call and translates `token_revoked` / `account_inactive` / `invalid_auth` into a typed `SlackTokenRevokedError`, and `missing_scope` into `SlackMissingScopeError`, so the UI can prompt reauthorization instead of surfacing a raw Slack error.
- **File uploads are capped** at 25MB app-side (`api/conversations/[id]/files/route.ts`) to bound memory use in the route handler — separate from whatever limit Slack itself enforces.

## 4. API routes

| Route | Does |
|---|---|
| `GET/POST /api/conversations` | List conversations (triggers a sync pass + notification check for all of them) |
| `GET/POST /api/conversations/:id/messages` | Fetch a conversation's messages (syncs first) / send a message or thread reply |
| `PATCH/DELETE /api/conversations/:id/messages/:messageId` | Edit / delete your own message |
| `POST /api/conversations/:id/messages/:messageId/reactions` | Toggle a reaction |
| `POST /api/conversations/:id/messages/:messageId/pin` | Pin / unpin |
| `POST /api/conversations/:id/messages/:messageId/save` | Save / unsave for later |
| `POST /api/conversations/:id/messages/:messageId/forward` | Forward to another conversation |
| `POST /api/conversations/:id/files` | Upload a file or voice note (multipart) |
| `GET /api/conversations/:id/members` | Conversation members, for @mention autocomplete |
| `GET /api/saved` | This user's saved messages |
| `GET/PATCH /api/status` | Read/update presence, status, Do Not Disturb |
| `POST /api/status/heartbeat` | Marks the user active (drives auto-away) |
| `GET/POST /api/oauth/slack`, `/api/oauth/slack/callback` | Slack OAuth handshake |
| `POST /api/auth/logout` | Destroy the session |
| `POST /api/slack/events` | Slack Events API webhook |
| `POST /api/push/subscribe`, `GET /api/push/vapid-public-key` | Web Push subscription management |
| `GET /api/files/proxy` | Proxies a Slack file URL through the server (the token needed to fetch it never reaches the browser) |
| `GET /api/health` | Liveness check |

## 5. Frontend architecture

```
ConversationThread.tsx          orchestrates: state, polling, derives roots/replies from the flat message list
  ├─ MessageBubble.tsx          renders one message (avatar, text, files, reactions, action menu)
  │    └─ ReactionPicker.tsx    searchable emoji grid
  ├─ Composer.tsx               text + @mentions + file attach + voice record + per-chat draft
  └─ ThreadPanel.tsx            root + replies for one thread, using MessageBubble + its own Composer
useMessageActions.ts            shared react/edit/pin/save/forward/delete state+handlers
```

`MessageBubble` and `Composer` are each used in **two** places (main timeline / thread panel) — `useMessageActions` exists specifically so opening a picker, editing, or forwarding behaves identically regardless of which list a message is rendered in, without duplicating that logic.

**Threads.** A message is a thread root if `threadTs` is null or equals its own `slackTs`; only roots render in the main timeline. Replies are grouped by `threadTs` into a `Map` once per render and looked up by root `slackTs` — no extra fetch, since the existing `GET /messages` call already returns every message (root and reply) in one flat, ascending-by-`slackTs` list. Opening a thread just sets which root's `slackTs` is "open" in local state; the panel is a sibling flex column on desktop (`sm:w-96 sm:shrink-0`) and a full-screen fixed overlay below that breakpoint.

**Reactions.** `src/lib/slack/emoji.ts` is a curated `{shortName: glyph}` map (155 entries, 7 categories) — not the full ~1800-entry Slack set, since names have to match what Slack's `reactions.add` API accepts. `ReactionPicker` searches this list client-side; an unrecognized name (e.g. a custom workspace emoji) still round-trips correctly via `emojiGlyph()`'s `:name:` fallback, it just won't render as a glyph.

**Files & voice notes.** The composer posts `multipart/form-data` to `/api/conversations/:id/files`, which calls `postFile()` (`lib/slack/sync.ts`). That calls Slack's `files.uploadV2`, then — deliberately — just runs the same incremental `syncMessages()` every other code path already uses to pick up the resulting message, rather than parsing `uploadV2`'s response shape to find the new message's `ts`. Voice notes are the same upload path with a client-recorded `Blob` (MediaRecorder, preferring `audio/webm;codecs=opus`) in place of a picked file; playback is a plain `<audio controls>` keyed off a new `isAudio` flag on `SlackFileView` (mimetype-sniffed at sync time).

**Drafts.** Deliberately `localStorage`, keyed `draft:<conversationId>` or `draft:<conversationId>:<threadTs>` — not a database table. A draft is exactly the kind of ephemeral, per-browser state where a network round-trip per keystroke would be the wrong tradeoff; nothing else in the app needs a draft to be visible from a second device.

## 6. Known limitations (by design, not oversight)

- **No typing indicators.** Slack only pushes these over Socket Mode/RTM, not the Web/Events API this app is built on. Adding it means holding a persistent connection to Slack, which is a bigger architectural change than the polling model here.
- **No read receipts.** Slack's API does not expose "who has seen this message" under any standard scope. A "seen by" feature here would have to be invented from scratch (track opens in our own DB) and would only be accurate for opens that happened through this app — not a faithful mirror of Slack.

## 7. Not yet built (scaffolded for, not implemented)

These have supporting groundwork already in place but no UI/route yet:

- **Search** — `search:read` scope is already granted; nothing calls `search.messages` yet. `components/search/` exists and is empty.
- **Settings UI** — `UserPreference` already models theme, density, per-category notification toggles, quiet hours, and low-bandwidth mode; none of it is editable from the UI yet. `components/settings/` exists and is empty.
- **Persistent sidebar** — the conversation list (`app/app/page.tsx`) is a separate screen from an open conversation today, not a docked sidebar. `components/sidebar/` exists and is empty.
- **Workspace branding** — `team:read` scope is granted; nothing calls `team.info` to show the real workspace name/icon.
- **`server/services/`** — empty; a placeholder for if/when logic inside `lib/slack/*` grows large enough to warrant splitting out, not something with a required feature behind it.
