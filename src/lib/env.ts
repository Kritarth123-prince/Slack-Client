import { z } from "zod";

const envSchema = z.object({
  SLACK_CLIENT_ID: z.string().min(1, "SLACK_CLIENT_ID is required"),
  SLACK_CLIENT_SECRET: z.string().min(1, "SLACK_CLIENT_SECRET is required"),
  SLACK_SIGNING_SECRET: z.string().min(1, "SLACK_SIGNING_SECRET is required"),
  SLACK_APP_TOKEN: z.string().optional(),
  // Extra user scopes to request but not require (comma-separated). Used for conversations.mark
  // — pushing "read here" to Slack — which needs channels:write,groups:write,im:write,mpim:write;
  // those aren't mandatory because not every Slack App configuration offers them.
  SLACK_EXTRA_USER_SCOPES: z.string().optional(),

  APP_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  VAPID_PUBLIC_KEY: z.string().min(1, "VAPID_PUBLIC_KEY is required"),
  VAPID_PRIVATE_KEY: z.string().min(1, "VAPID_PRIVATE_KEY is required"),
  VAPID_SUBJECT: z.string().min(1, "VAPID_SUBJECT is required"),

  TOKEN_ENCRYPTION_KEY: z.string().min(1, "TOKEN_ENCRYPTION_KEY is required"),

  // Optional speech-to-text for voice notes. Any server that speaks the OpenAI-style
  // `POST /v1/audio/transcriptions` multipart API works: OpenAI Whisper, Groq, a local
  // faster-whisper server, or your own Hindi/Hinglish ASR model behind that interface.
  // Leave TRANSCRIPTION_API_URL unset to turn the feature off.
  TRANSCRIPTION_API_URL: z.string().url().optional(),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().default("whisper-1"),
  TRANSCRIPTION_LANGUAGE: z.string().optional(), // ISO-639-1 hint such as "hi"; omit to auto-detect

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validates process.env once and caches the result. Throws with a clear
 * message listing every missing/invalid variable, rather than failing
 * deep inside a Slack API call at request time.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the values.`);
  }

  cached = parsed.data;
  return cached;
}
