/**
 * Structured logging with automatic redaction of sensitive keys.
 * Never pass Slack tokens, session secrets, or VAPID private keys through
 * unredacted fields — this only protects against them appearing in a
 * *named* field (e.g. `{ token }`); string-interpolated secrets in a
 * message still leak, so build call sites with fields, not templates.
 */

const REDACTED_KEYS = new Set([
  "token",
  "accessToken",
  "access_token",
  "encryptedAccessToken",
  "clientSecret",
  "client_secret",
  "signingSecret",
  "signing_secret",
  "vapidPrivateKey",
  "sessionSecret",
  "password",
  "authTag",
  "cookie",
]);

type LogFields = Record<string, unknown>;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.has(key) ? "[redacted]" : value;
  }
  return out;
}

function write(level: "info" | "warn" | "error", message: string, fields: LogFields = {}) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...redact(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
