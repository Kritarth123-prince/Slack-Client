# Technical overview

This document explains how the app is built: the sync model, data model, security decisions, and how each feature is implemented. For what the app does and how to run it, see [`../README.md`](../README.md).

## 1. Architecture at a glance

```text
 Slack (real workspace)
   │  OAuth (user token) ── one-time authorisation
   │  Events API (webhook, push)         Web API (REST, pull + write)
   ▼                                          ▲
┌───────────────────────────────────────────────────────┐
│                    Next.js server                     │
│  /api/slack/events  ──▶ processSlackEvent ──▶ Postgres│
│  /api/conversations/* ──▶ lib/slack/sync.ts ──────────│
│  /api/search, preferences, link-preview, …            │
│                 ──▶ server/services/*   (Prisma)      │
└───────────────────────────────────────────────────────┘
   ▲ polls every 4s (open conversation) / 15s (list) + on tab focus
   │
 Browser (React Server + Client Components)
```

Postgres is a **local mirror** of whatever the authorising user can already see in Slack — it is never a second source of truth. Every write path (send, edit, delete, react, pin, upload, display name) calls Slack's API first and only reflects the change locally after Slack accepts it. The exceptions are deliberately app-only state: drafts, saved messages, preferences, link-preview cache, typing heartbeats and read cursors — things Slack either doesn't model or doesn't expose.

There are two independent update paths, which is why the app feels close to real-time despite holding no persistent connection to the browser:

1. **Slack → server (push).** Slack calls `POST /api/slack/events` for every message/reaction event. The signature is verified (`verifySlackSignature`), the delivery is deduplicated against `ProcessedSlackEvent` (Slack retries, so the same `event_id` can arrive twice), and `processSlackEvent` writes the change into Postgres.
2. **Server → browser (poll).** The open conversation polls `GET /api/conversations/:id/messages` every 4 seconds (and on `visibilitychange`). That call also runs an incremental `syncMessages()` first, so new messages still appear even when the webhook isn't reaching the deployment. A separate, unconditional 15s poll of `GET /api/conversations` (from the sidebar/list) drives unread counts and push notifications for every conversation, not just the open one.

## 2. Code layout

| Directory | Holds |
| --- | --- |
| `src/lib/slack/` | Everything that talks to Slack: `client.ts` (per-user `WebClient` from the encrypted token), `sync.ts` (history, thread backfill, send/edit/delete, uploads, reactions, event handling), `scopes.ts`, `formatSlackText.tsx`, `presence.ts`, small helpers (`links.ts`, `messageFiles.ts`, `reactionGroups.ts`). |
| `src/server/services/` | Feature logic that composes DB + Slack calls and is shared by pages and route handlers: `conversations.ts` (list, unread counts, pinned/muted ordering), `search.ts`, `workspace.ts` (`team.info` branding), `preferences.ts`, `linkPreview.ts`, `presenceSignals.ts` (typing + read receipts), `scheduled.ts` (`chat.scheduleMessage`), `reminders.ts` (`reminders.add`), `customEmoji.ts` (`emoji.list`), `transcription.ts` (speech-to-text), `conversationSettings.ts` (pin/mute). New logic goes here; `lib/slack/sync.ts` stays as the Slack sync core. |
| `src/lib/slack/installation.ts` | `getActiveInstallation` / `getInstallationForWorkspace`: the single place that decides which of a user's connected workspaces (and therefore which token) an action runs under. Everything that needs a Slack client goes through it — that's what makes workspace switching a one-field change on `User.activeWorkspaceId`. |
| `src/app/api/` | Thin route handlers: auth check → validate input → call a service/sync function → JSON. |
| `src/app/app/` | The signed-in UI. `layout.tsx` renders the desktop sidebar around every page; `page.tsx` is the phone-sized conversation list; `[id]/` is a conversation; `search/`, `settings/`, `saved/` are pages. |
| `src/components/` | Client components grouped by area (see §5). |
| `src/hooks/` | `useDraft`, `useAudioRecorder`, `useClickOutside`. |
| `src/lib/ui/` | `emoji.ts` (dataset + search), `EmojiGlyph.tsx` (flag rendering), avatar helpers. |

## 3. Data model

Defined in [`../prisma/schema.prisma`](../prisma/schema.prisma).

| Model | Purpose |
| --- | --- |
| `User` | One row per person who has connected a Slack account here; `activeWorkspaceId` is the workspace currently shown. |
| `ConversationSetting` | Per-user pin/mute flags for a conversation — pinned sorts to the top, muted drops out of push notifications and badges. |
| `CustomEmoji` | The workspace's custom emoji (name → image URL) from `emoji.list`, refreshed at most daily; aliases resolved at sync time. |
| `VoiceTranscript` | Speech-to-text output for a voice note, keyed by Slack file id so it's produced once. |
| `Session` | Server-side session backing the HttpOnly cookie — revocable independently of cookie lifetime. |
| `SlackInstallation` | The encrypted OAuth token for one `(workspace, Slack user)` pair, plus granted scopes. |
| `Workspace` | Cached team metadata; `name`/`domain`/`iconUrl` refreshed from `team.info` at most daily. |
| `SlackUser` | Cached profile info for anyone referenced by a message/conversation — bulk-synced on list load, lazily otherwise. |
| `Conversation` / `ConversationMember` | Synced channels/DMs and who's in them. |
| `Message` | A Slack message. `threadTs == slackTs` for a root; replies point `threadTs` at the parent. No `Thread` table — reply counts are derived. `raw` keeps Slack's full payload (files, `reply_count`, blocks). |
| `Reaction` | One row per `(message, emoji, user)`. |
| `SavedMessage` | Per-user "save for later" bookmark. |
| `ReadState` | Per-user, per-conversation last-read `slackTs`. Drives unread counts *and* read receipts. |
| `Draft` | Unsent composer text per `(user, conversation, threadTs)`. `threadTs` is `""` for the main composer — a non-null sentinel rather than `NULL`, because Postgres treats every `NULL` as distinct in a unique index, which would break the upsert. |
| `TypingIndicator` | A heartbeat per `(conversation, threadTs, user)`; rows older than 8s are ignored, older than 60s purged. |
| `LinkPreview` | Cached Open Graph metadata per URL, including a `failed` flag so unreachable links aren't re-fetched every poll. |
| `NotificationSubscription` | A browser's Web Push subscription. |
| `UserPreference` | Theme, density, notification toggles, quiet hours + `timezone`, presence/status, DND. Editable from *Settings*. |
| `ProcessedSlackEvent` | Webhook dedup keyed by Slack's `event_id`. |

## 4. Auth & security

- **User-token scopes, not bot scopes** (`src/lib/slack/scopes.ts`). The app acts *as the person who signed in*; it can't see anything they couldn't. The OAuth callback rejects a partial grant (`insufficient_scope`) rather than degrading silently.
- **Tokens encrypted at rest**: AES-256-GCM (`tokenCipher.ts`), key from `TOKEN_ENCRYPTION_KEY`. Decrypted only inside `getSlackClientForUser` for the life of one request; never logged or sent to the browser.
- **Sessions are cookie + DB-backed**: `iron-session` encrypts an HttpOnly cookie holding a session-row id; `requireUserId` validates that row, so sessions can be revoked server-side.
- **Webhooks are signature-verified** against `SLACK_SIGNING_SECRET` before parsing.
- **Slack error handling** is per call site: write paths inspect `err.data.error` and map `missing_scope` to a 403 with a "reconnect" message (uploads, search, display name) so the UI can prompt re-authorisation instead of showing a generic failure.
- **File proxy** (`/api/files/proxy`) only fetches from Slack's file hosts, forwards `Range` requests and relays `206`/`Content-Range` — mobile Safari refuses to play media otherwise.
- **Link previews** are fetched server-side with SSRF guards: `http(s)` only, private/loopback hosts refused (including after redirects, via `response.url`), 6s timeout, 512KB read cap, HTML only.
- **Uploads are capped** at 25MB and 10 files per message, app-side, to bound route-handler memory.

## 4a. API routes

| Route | Does |
| --- | --- |
| `GET /api/conversations` | List (syncs every conversation + notification check) — includes `unreadCount`, `pinned`, `muted` |
| `GET/POST /api/conversations/:id/messages` | Messages (syncs first; includes `typing` and `readers`) / send a message or reply |
| `PATCH/DELETE /api/conversations/:id/messages/:messageId` | Edit / delete your own message |
| `POST …/messages/:messageId/reactions`, `/pin`, `/save`, `/forward` | Toggle reaction, pin, save, forward |
| `POST /api/conversations/:id/files` | Upload one or more files / a voice note as a single message (multipart) |
| `GET/PUT /api/conversations/:id/draft` | Load / save unsent text (per thread via `threadTs`) |
| `POST /api/conversations/:id/typing` | Typing heartbeat (`stop: true` clears it) |
| `POST /api/conversations/:id/read` | Move the read cursor ("mark unread from here") |
| `GET/PATCH /api/conversations/:id/settings` | Pin / mute |
| `GET/POST/DELETE /api/conversations/:id/scheduled` | List / schedule / cancel "send later" messages |
| `GET /api/conversations/:id/members` | Members, for @mention autocomplete |
| `POST /api/reminders` | "Remind me about this message" |
| `GET /api/search?q=` | Slack `search.messages`, mapped onto local conversations |
| `GET /api/emoji` | Custom emoji map (syncs at most daily) |
| `GET /api/link-preview?url=` | Cached Open Graph metadata |
| `GET /api/files/proxy?url=` | Authenticated, range-aware proxy for Slack file bytes |
| `GET /api/files/transcript?fileId=&url=` | Voice-note transcript (`disabled` when no endpoint is configured) |
| `GET/PATCH /api/preferences` | Settings, including display name |
| `GET/POST /api/workspaces` | Connected workspaces / switch the active one |
| `GET/PATCH /api/status`, `POST /api/status/heartbeat` | Presence, status, DND; activity heartbeat |
| `GET /api/saved` | Saved messages |
| `GET /api/oauth/slack`, `/callback`, `POST /api/auth/logout` | OAuth (also "add another workspace" while signed in) / logout |
| `POST /api/slack/events` | Slack Events API webhook |
| `POST /api/push/subscribe`, `GET /api/push/vapid-public-key` | Web Push |

## 5. Frontend architecture

```text
app/app/layout.tsx                 desktop sidebar (Sidebar → WorkspaceBadge, nav, StatusMenu, ConversationList) + <main>
app/app/[id]/ConversationThread    state, 4s poll, thread grouping, seen-by/typing derivation
  ├─ MessageBubble                 one message: avatar, text, LinkPreviewCard, files, reactions, "N replies", action menu
  │    └─ EmojiPicker              searchable grid (also used by the composer)
  ├─ TypingLine + Composer         text, @mentions, emoji insert, attach, voice record, pending-attachment previews, draft
  └─ ThreadPanel                   root + replies via MessageBubble, its own TypingLine + Composer
components/search/SearchPanel      debounced search UI
components/settings/SettingsForm   autosaving preferences form
hooks/useDraft                     load once, debounced PUT, clear on send (callers remount via key when the target changes)
hooks/useAudioRecorder             MediaRecorder wrapper (webm/opus → webm → mp4 fallback, 5-minute cap)
hooks/useClickOutside              closes popovers on outside pointer-down
```

`MessageBubble` owns its own popover state (reaction picker, menu, forward list) so it works identically in the feed and the thread panel. `Composer` is likewise instantiated twice; each instance is keyed by conversation/thread so switching targets remounts it with a fresh draft.

**Threads.** Only roots (`threadTs` null or equal to `slackTs`) render in the feed; replies are grouped by `threadTs` into a `Map` per render from the flat message list. Slack's `conversations.history` never returns replies, and once a root is cached the incremental `oldest` cursor never returns it again — so `sync.ts` runs `backfillStaleThreads()` after every sync: a single SQL query finds roots whose cached `raw.reply_count` exceeds the local reply-row count, and only those threads are fetched via `conversations.replies`.

**Reactions & emoji.** `lib/ui/emoji.ts` is a hand-curated list of ~576 `{name, glyph, keywords}` entries whose names are Slack's canonical shortcodes (so `reactions.add` accepts them); the picker searches names and keywords client-side and shows the whole set when the query is empty. `EmojiGlyph` renders regional-indicator pairs (flags) as Twemoji SVGs from jsDelivr because Windows has no flag glyphs; `formatSlackText` does the same for flags inside message text. Unknown names (custom workspace emoji) fall back to `:name:`.

**Files & voice notes.** Picked files and recordings land in a pending list with previews (image thumbnail / `<audio>` player / name) and are only uploaded on Send, as one `multipart/form-data` request. The route calls `uploadFiles()`, which uses `files.uploadV2` with a `file_uploads` batch (one Slack message for all files, caption as `initial_comment`), then re-runs the ordinary `syncMessages()` to pick the message up rather than parsing `uploadV2`'s response. Audio detection for playback checks Slack's `mimetype`, its `filetype`, *and* the filename extension, since browser-recorded audio isn't always labelled `audio/*`.

**Drafts.** Server-side, not `localStorage`: `useDraft` loads on mount, debounces a `PUT` 600ms after the last keystroke, and deletes the row on send. Per conversation and per open thread.

**Theme & density.** The root layout reads `UserPreference` and sets `data-theme-pref`/`data-density` on `<html>`; an inline script resolves "system" via `prefers-color-scheme` before first paint and tracks OS changes. Tailwind's `dark:` variant is remapped to `[data-theme="dark"]` via `@custom-variant`, so every existing `dark:` utility follows the setting. Density is a CSS rule on `.message-feed`.

**Notifications.** `notificationAllowed()` in `lib/push.ts` applies muted conversations, DND, quiet hours (evaluated in the user's saved IANA timezone), and the per-type toggles; mentions (`<@you>`, `@here/@channel`) override the per-conversation-type toggle. Both notify paths — the webhook and the polling fallback — go through it.

**Composer.** An auto-growing `<textarea>` (Enter sends, Shift+Enter newline, IME-safe). Formatting is plain Slack mrkdwn wrapped around the selection (`*`, `_`, `~`, `` ` ``, `> `), via toolbar or shortcuts. Files arrive from the picker, `paste` (clipboard files) or drag-and-drop — the conversation view forwards drops through a `ComposerHandle` ref so the composer keeps owning the pending list. "Send later" posts to `/scheduled`, which validates `post_at` (≥1 min ahead, ≤120 days) and calls `chat.scheduleMessage`; `ScheduledList` shows what's queued from `chat.scheduledMessages.list`.

**Custom emoji.** `CustomEmojiProvider` fetches `/api/emoji` once per session (module-cached) and provides a name → URL map through context; `EmojiText` (used by `SlackText`) replaces `:name:` tokens with the custom image or the standard glyph, `ReactionEmoji` does the same for reaction pills, and the picker lists custom emoji first. The composer inserts `:name:` for custom picks because that's what Slack renders.

**Quick switcher / workspaces.** `QuickSwitcher` is mounted in the app layout with the same list the sidebar gets; Ctrl/Cmd+K opens it, matching by prefix/substring/subsequence. `WorkspaceSwitcher` lists `SlackInstallation` rows for the user and `POST /api/workspaces` sets `User.activeWorkspaceId`; the OAuth callback attaches a new installation to the signed-in user (rather than creating a second account) and makes it active.

**"New messages" divider.** The page captures `ReadState.lastReadTs` *before* advancing it, passes it as `initialLastReadTs`, and the view draws the line before the first message from someone else past that cursor — frozen for the life of the view so it doesn't move as the poll re-marks the conversation read. "Mark unread from here" sets the cursor to the previous message's ts and navigates away, since staying would re-mark it within 4s.

**Voice transcription.** `getVoiceTranscript()` downloads the note with the user's token, posts it as multipart to `TRANSCRIPTION_API_URL` (OpenAI `/v1/audio/transcriptions` shape: `file`, `model`, optional `language`), and caches the text in `VoiceTranscript`. The client component asks once per file and remembers a `disabled` answer for the session.

**PWA.** `public/sw.js` precaches the offline page, serves `/_next/static` cache-first, and uses network-first-with-cache-fallback for navigations and the read-only list/messages/emoji endpoints; `ServiceWorkerRegistration` registers it on every signed-in page (previously only when push was enabled).

**Sidebar.** `app/app/layout.tsx` does a plain DB read for the list (no Slack sync) so opening a conversation doesn't pay for a workspace sweep; the sidebar's own 15s poll and the `/app` page trigger the sync. Below `md` the sidebar is hidden and `/app` renders the list full-screen.

**Search.** `search.messages` (sorted by timestamp) → matches are mapped onto cached conversations and messages so a result links to `/app/:id#message-:localId`; uncached hits fall back to Slack's permalink.

**Link previews.** `firstLinkIn()` extracts the first URL (Slack `<url|label>` or bare); `LinkPreviewCard` fetches `/api/link-preview` through a module-level promise cache so a 4s poll re-render never re-fetches; the server caches results in `LinkPreview`. Slack's own hosts are skipped (they need the user's token and already render as attachments).

## 6. Typing indicators & read receipts — how and why they're app-local

Slack's Web API exposes neither. Typing is an RTM/Socket Mode event that user tokens can't emit, and per-user read state is never shared with any app. Rather than leave both out, they're implemented against this app's own tables with the scope made explicit in the UI:

- **Typing.** While a composer has text and keys are being pressed, it `POST`s `/api/conversations/:id/typing` at most every 3s (`TypingIndicator` upsert with an explicit `updatedAt`). The 4s messages poll returns everyone else whose heartbeat is under 8s old, split by `threadTs`; sending clears the row. Worst-case display latency is one poll interval, which is the same budget as new messages.
- **Read receipts.** `markConversationRead` already advances `ReadState.lastReadTs` on every poll from a *visible* tab. `listReaders()` returns the other app users' cursors for the conversation; the client shows "✓ Seen by …" on the newest feed message at or below each reader's cursor — one label per person, like a receipt, not on every message.

Both therefore describe activity inside this client only. Someone reading in Slack's official app produces no receipt here, and no heartbeat from here reaches Slack. That's a limitation of Slack's API, not a bug, and it's why these are labelled as app-local rather than presented as Slack features.

## 7. Known limitations

- **History depth.** Sync pulls the newest 50 messages on first open and only newer ones afterwards; there's no backwards pagination. Search results for older, uncached messages open the conversation without scrolling to the message.
- **Flag emoji depend on a CDN** (Twemoji via jsDelivr); offline they show alt text.
- **Link previews** rely on the target site serving Open Graph/HTML to a server-side fetch; bot-blocking sites get no card.
- **Transcription is bring-your-own-endpoint**: no model ships with the app.
- **Offline is read-only**: cached pages and last-fetched messages only; writes need a connection and aren't queued.
- **Reminders and custom emoji need new scopes** (`reminders:write`, `emoji:read`) — existing installs must reconnect.
