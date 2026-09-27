# Slack Web

A native web client for Slack, built on the real Slack API — you sign in with your own Slack account and it renders and drives your actual workspace, rather than being a demo chat app with its own fake backend.

It exists because Slack's official web/desktop client doesn't run well (or at all) on some setups, and because a self-hosted client gives full control over the message store, notification behavior, and UI. It talks to Slack using **your own user token** (not a bot), so it only ever sees what you can already see in Slack.

## Features

**Messaging**
- Channels, private channels, DMs, and group DMs, synced from your real workspace
- Send, edit, and delete your own messages
- `@mention` autocomplete
- Slack-formatted text rendering (mentions, basic markdown)

**Threads**
- Root messages show a reply count; opening it slides in a dedicated thread panel
- Reply inside the thread panel without leaving the main conversation
- Thread panel runs side-by-side with the conversation on desktop, full-screen on mobile

**Reactions**
- Full searchable emoji picker (155+ curated emoji across 7 categories), not just a fixed quick-react bar
- Toggle your own reaction on/off; see everyone else's counts live

**Files & voice notes**
- Attach any file from the composer; images render inline, everything else as a download card
- Record a voice note directly in the browser (mic button → record → send) — no separate app needed
- Uploads go through Slack's real file-upload API, so they show up in Slack for everyone else too

**Drafts**
- Unsent text is remembered per conversation *and* per open thread
- Restored automatically when you come back, cleared automatically once sent

**Message actions**
- Pin / unpin, save for later (personal bookmarks), forward to another conversation

**Presence, status & notifications**
- Custom status text/emoji with optional auto-expiry, Active/Away, Do Not Disturb
- Auto-away after inactivity (configurable)
- Web Push notifications for DMs, mentions, and thread replies, with quiet hours

## Tech stack

- **Next.js 16** (App Router) + **React 19**, TypeScript throughout
- **PostgreSQL** via **Prisma** — a local mirror of the Slack data you can see, not a separate source of truth
- **Slack Web API** (`@slack/web-api`) for every read/write, plus the **Events API** for near-real-time push
- **iron-session** for encrypted, revocable sessions; Slack tokens encrypted at rest (AES-256-GCM)
- **web-push** for browser notifications
- Tailwind CSS v4

See [`TECHNICAL.md`](./TECHNICAL.md) for how these fit together.

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

Open [http://localhost:3000](http://localhost:3000), sign in with Slack, and authorize the app.

## Environment variables

All variables are validated on startup (`src/lib/env.ts`) — the app refuses to boot with a clear error if any are missing. Full template: [`.env.example`](./.env.example).

| Variable | Purpose |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | From your Slack App's **Basic Information** page |
| `SLACK_APP_TOKEN` | Optional — only needed if you switch to Socket Mode instead of HTTP Events |
| `APP_BASE_URL` | Public URL of this deployment (OAuth redirect + push links), no trailing slash |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 32+ byte random string — `openssl rand -base64 32` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys — `npx web-push generate-vapid-keys` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key used to encrypt Slack tokens at rest — `openssl rand -base64 32` |

Setting up the Slack App itself (OAuth redirect URL, scopes, event subscriptions) is covered step by step in [`docs/slack-app-setup.md`](./docs/slack-app-setup.md).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / start |
| `npm run lint` | ESLint |
| `npx prisma migrate dev` | Create/apply a migration in development |
| `npx prisma studio` | Browse the database |

## Project structure

```
src/
  app/                 # Next.js App Router: pages + API routes
    api/                 conversations, files, messages, reactions, oauth, push, status, slack events
    app/                 the signed-in UI (conversation list, [id] conversation view, saved messages)
  components/
    composer/            message composer (text, @mentions, file attach, voice notes, drafts)
    conversation/         message bubble, reaction picker
    thread/                thread panel
  hooks/                 shared client-side logic (message actions: react/edit/pin/forward/delete)
  lib/
    slack/                everything that talks to Slack's API, plus sync/scopes/formatting
    auth/, db/, ui/        sessions, Prisma client, small UI helpers
  types/                 shared TypeScript types
prisma/schema.prisma    # data model
docs/slack-app-setup.md # Slack App creation walkthrough
```

For the architecture behind this (sync strategy, data model rationale, security model), see [`TECHNICAL.md`](./TECHNICAL.md).

## Known limitations

- **Typing indicators** aren't implemented — Slack only exposes these over Socket Mode/RTM, not the REST API this app is built on.
- **Read receipts** aren't implemented — Slack's API doesn't expose "who's seen this message" at all; faking it would require inventing non-Slack semantics.
- Search, an in-app settings UI, and a persistent sidebar are not yet built (the scopes/schema already support search and per-user settings — see `TECHNICAL.md`'s "Not yet built" section).
