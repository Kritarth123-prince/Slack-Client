# Creating the Slack App

This app authenticates as **you** (a Slack *user* token), not as a separate
bot added to your workspace. That means it only ever sees conversations and
data you can already see in Slack — it can't be granted broader access than
your own Slack account has.

> **Before you connect this to a real workplace workspace:** confirm your
> employer's policy permits syncing workplace messages to a server you
> control, especially if that server is hosted outside company
> infrastructure. This is your call to make, not a technical one.

## 1. Create the app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it (e.g. "Personal Slack Client") and pick your workspace.

## 2. OAuth & Permissions

Under **OAuth & Permissions**:

- Add a **Redirect URL**: `${APP_BASE_URL}/api/oauth/slack/callback`
  (e.g. `http://localhost:3000/api/oauth/slack/callback` for local dev).
- Under **User Token Scopes** (not Bot Token Scopes), add exactly the scopes
  listed in [`src/lib/slack/scopes.ts`](../src/lib/slack/scopes.ts):

| Scope | Why the app needs it |
|---|---|
| `channels:read` | List public channels you're a member of |
| `groups:read` | List private channels you're a member of |
| `im:read` | List your direct messages |
| `mpim:read` | List your group DMs |
| `channels:history` | Read message history in public channels |
| `groups:history` | Read message history in private channels |
| `im:history` | Read DM history |
| `mpim:history` | Read group DM history |
| `chat:write` | Send messages and thread replies as you |
| `reactions:read` | See existing emoji reactions |
| `reactions:write` | Add/remove your emoji reactions |
| `pins:write` | Pin/unpin messages from within the app |
| `users:read` | Resolve user IDs to names/avatars |
| `users.profile:read` | Read profile details for display |
| `files:read` | Download files/images attached to messages |
| `search:read` | Power the in-app search screen |
| `team:read` | Show workspace name/icon in the UI |

If you don't intend to use a feature (e.g. search), you can omit its scope —
the app degrades that one feature and tells you why in the UI, rather than
failing everything.

## 3. Event Subscriptions

Under **Event Subscriptions**:

- Enable events.
- Request URL: `${APP_BASE_URL}/api/slack/events`
  Slack sends a verification challenge to this URL first — the route
  handles it automatically (see `src/lib/slack/events.ts`).
- Subscribe to these **workspace events** (each requires the matching scope
  above):
  - `message.channels`, `message.groups`, `message.im`, `message.mpim`
  - `reaction_added`, `reaction_removed`

## 4. Install the app

Under **Install App**, install it to your workspace. You do **not** need to
do this manually before using the product — the app's own "Connect Slack"
button drives the same OAuth flow. Installing here first is only useful for
verifying your scope/redirect configuration during setup.

## 5. Copy credentials into `.env`

From **Basic Information**:

- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`

## Local development and the Events API

Slack must be able to reach `${APP_BASE_URL}/api/slack/events` over HTTPS.
For local development, use a tunnel (e.g. `ngrok http 3000`) and set both
`APP_BASE_URL` and the Slack app's Request URL / Redirect URL to the tunnel's
HTTPS address. See `docs/deployment.md` for the hosted-deployment story,
including why long-lived Events API delivery is the deciding factor in which
free/low-cost host actually works.
