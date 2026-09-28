# Slack Web

A native web client for Slack, built on the real Slack API — you sign in with your own Slack account and it renders and drives your actual workspace, rather than being a demo chat app with its own fake backend.

It exists because Slack's official web/desktop client doesn't run well (or at all) on some setups, and because a self-hosted client gives full control over the message store, notification behaviour, and UI. It talks to Slack using **your own user token** (not a bot), so it only ever sees what you can already see in Slack.

## Features

**Messaging**
- Channels, private channels, DMs, and group DMs, synced from your real workspace
- Send, edit, and delete your own messages; `@mention` autocomplete
- Multi-line composer: Enter sends, Shift+Enter adds a line; bold/italic/strike/code/quote via a toolbar or Ctrl+B / Ctrl+I / Ctrl+Shift+X / Ctrl+E / Ctrl+Shift+.
- Send later — a clock button schedules the message via Slack's `chat.scheduleMessage`; queued messages are listed above the composer and can be cancelled
- Slack-formatted text rendering (mentions, channel refs, links, quotes, bold/italic/strike/code, `:emoji:` shortcodes)
- Link previews — the first URL in a message unfurls into a title/description/image card
- "New messages" divider at your last-read point when you open a chat, and "Mark unread from here" in a message's menu
- Read state stays in step with Slack: reading a conversation in Slack's own app clears it here (Slack's `last_read` is polled for unread conversations), and reading here can clear it in Slack too — see `SLACK_EXTRA_USER_SCOPES`
- Every message shows its time (24-hour, your local zone; hover for the full date) and the feed is split by day
- Numeric unread counts per conversation, not just a dot; pin favourites to the top and mute chats you don't want notifications from
- Ctrl+K quick switcher — jump to any conversation by typing part of its name
- "Remind me about this" on any message (in 20 min / 1 h / 3 h / tomorrow / next week / custom) via Slack's own reminders

**Threads**
- Root messages show a "💬 N replies" pill; opening it slides in a dedicated thread panel with its own composer
- Replies are hidden from the main feed (Slack-style) and grouped by thread
- Threads that already had replies before you first opened a channel are backfilled automatically

**Reactions & emoji**
- Searchable emoji picker with 570+ emoji across smileys, gestures, hearts, symbols, objects, nature, food, activities, and 60+ flags — plus a one-click quick-react row
- Your workspace's custom emoji (from `emoji.list`) appear in the picker, in reactions, and inline in message text
- Flags render as images on every platform (Windows has no native flag glyphs), so 🇮🇳 never shows up as "IN"
- Toggle your own reaction on/off; see everyone else's counts live

**Files & voice notes**
- Attach files from the composer, paste a screenshot with Ctrl+V, or drag and drop several files onto the conversation; they go out as a single message with a caption
- Record a voice note in the browser, preview it with a player, then send or discard
- Optional voice-note transcription: point `TRANSCRIPTION_API_URL` at any OpenAI-style speech-to-text endpoint (Whisper, Groq, a local server, or your own Hindi/Hinglish ASR model) and transcripts appear under each voice note
- Everything is previewed before it's sent — nothing uploads until you press Send
- Images render inline, audio gets an inline player (with seeking that works on iOS), everything else a download card
- Uploads go through Slack's real file-upload API, so they show up in Slack for everyone else too

**Drafts**
- Unsent text is saved server-side per conversation *and* per open thread, so it survives reloads and follows you across devices
- Restored automatically when you come back, cleared once sent

**Search**
- Full-text search over your workspace via Slack's own `search.messages`, with results deep-linking straight into the conversation

**Sidebar & navigation**
- On desktop, a persistent sidebar (workspace switcher, search, saved, settings, status, live conversation list) sits beside whichever conversation is open; on phones the list is its own screen
- Real workspace name and icon from `team.info` instead of a generic header
- Multiple workspaces: connect another workspace from the switcher and flip between them; each keeps its own token, conversations and settings
- Installable as an app (PWA) with offline support — recently opened conversations and the conversation list still load without a network

**Settings**
- Display name (pushed to your real Slack profile), theme (System / Light / Dark), message density
- Notification toggles for DMs, mentions, thread replies, and channel messages; quiet hours in your own timezone — all actually enforced by the push-notification path

**Typing indicators & read receipts (app-local)**
- "X is typing…" under the composer and in open threads
- "✓ Seen by …" on the newest message each person has reached
- Both work between people using *this* client only — Slack's API doesn't expose either, so they can't reflect activity in Slack's own apps. See *Known limitations*.

**Message actions**
- Pin / unpin, save for later (personal bookmarks), forward to another conversation

**Presence, status & notifications**
- Custom status text/emoji with optional auto-expiry, Active/Away, Do Not Disturb, auto-away after inactivity
- Web Push notifications, filtered by your notification settings and quiet hours

## Tech stack

- **Next.js 16** (App Router) + **React 19**, TypeScript throughout
- **PostgreSQL** via **Prisma** — a local mirror of the Slack data you can see, not a separate source of truth
- **Slack Web API** (`@slack/web-api`) for every read/write, plus the **Events API** for near-real-time push
- **iron-session** for encrypted, revocable sessions; Slack tokens encrypted at rest (AES-256-GCM)
- **web-push** for browser notifications
- Tailwind CSS v4, `lucide-react` icons — no component library, no emoji library

See [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) for how these fit together.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- A Slack workspace where you can create a Slack App (see [`docs/slack-app-setup.md`](./docs/slack-app-setup.md))

## Installation

```bash
git clone <this-repo>
cd slack-web
npm install
cp .env.example .env   # then fill in the values, see below
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Slack, and authorise the app.

> **Adding scopes later:** whenever `src/lib/slack/scopes.ts` gains a scope (`files:write` for uploads, `reminders:write` for reminders, `emoji:read` for custom emoji), add it under *User Token Scopes* in your Slack App's config **and** reconnect from *Settings → Reconnect Slack*. Until both are done, that feature shows a "reconnect" prompt rather than failing silently.

## Environment variables

All variables are validated on startup (`src/lib/env.ts`) — the app refuses to boot with a clear error if any are missing. Full template: [`.env.example`](./.env.example).

| Variable | Purpose |
| --- | --- |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | From your Slack App's **Basic Information** page |
| `SLACK_APP_TOKEN` | Optional — only needed if you switch to Socket Mode instead of HTTP Events |
| `SLACK_EXTRA_USER_SCOPES` | Optional — extra scopes to request but not require; `channels:write,groups:write,im:write,mpim:write` lets reads here mark conversations read in Slack |
| `APP_BASE_URL` | Public URL of this deployment (OAuth redirect + push links), no trailing slash |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 32+ byte random string — `openssl rand -base64 32` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys — `npx web-push generate-vapid-keys` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key used to encrypt Slack tokens at rest — `openssl rand -base64 32` |
| `TRANSCRIPTION_API_URL`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_LANGUAGE` | Optional — an OpenAI-compatible `/v1/audio/transcriptions` endpoint for voice-note transcripts (unset = off) |

Setting up the Slack App itself (OAuth redirect URL, scopes, event subscriptions) is covered step by step in [`docs/slack-app-setup.md`](./docs/slack-app-setup.md).

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / start |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check without building |
| `npx prisma migrate dev` | Create/apply a migration in development |
| `npx prisma studio` | Browse the database |

## Project structure

```
src/
  app/
    api/                 route handlers: conversations (messages, files, draft, typing, members,
                         reactions/pin/save/forward), search, preferences, link-preview, status,
                         saved, oauth, push, slack events, files/proxy, health
    app/                 signed-in UI: layout (sidebar), conversation list, [id] conversation,
                         search, settings, saved
  components/
    sidebar/             Sidebar, WorkspaceBadge
    conversation/        MessageBubble, LinkPreviewCard, TypingLine
    composer/            Composer (multi-line text, formatting, @mentions, emoji, attach/paste/drop,
                         voice notes, send later), EmojiPicker, ScheduledList
    thread/              ThreadPanel
    search/              SearchPanel
    settings/            SettingsForm
    pwa/                 service worker registration
  hooks/                 useDraft, useAudioRecorder, useClickOutside
  server/services/       conversations, search, workspace, preferences, linkPreview, presenceSignals,
                         scheduled, reminders, customEmoji, transcription, conversationSettings
  lib/
    slack/               Slack client, sync (history, threads, uploads, reactions, events), scopes,
                         text formatting, file/link helpers, presence
    ui/                  emoji dataset, flag rendering, avatar helpers
    auth/, db/, push.ts  sessions, Prisma client, push + notification policy
  types/                 shared TypeScript types
prisma/                  schema + migrations
docs/                    slack-app-setup.md, TECHNICAL.md, project overview (.docx)
```

## Known limitations

- **Typing indicators and read receipts are app-local.** Slack only emits typing over RTM/Socket Mode (not the Web API), and never exposes per-user read state to anyone. Both features here are backed by this app's own tables, so they show what other users of *this client* are doing — never what someone is doing in Slack's official apps. They are labelled as such in the UI.
- **History depth.** Each conversation syncs the most recent messages on first open (and everything newer after that); there's no "load older" pagination yet, so search results for very old messages open the conversation without scrolling to the exact message.
- **Voice-note transcription needs an endpoint.** Nothing is bundled — set `TRANSCRIPTION_API_URL` (and a key if the service needs one) or the feature stays hidden.
- **Flag emoji are loaded from a CDN** (Twemoji SVGs via jsDelivr), because Windows has no native flag glyphs. Offline, flags fall back to the alt text.
- **Offline mode is read-only.** The service worker serves cached pages and the last fetched messages; sending, reacting and uploading need a connection.
- **Link previews** are fetched by the server from the linked site; sites that block bots or have no Open Graph tags simply don't get a card.
