import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slack Web",
  description: "A personal Slack client.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Slack Web",
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

// Resolves the saved theme preference ("system" → whichever the OS says) into data-theme before
// first paint, and keeps following OS changes while the preference is "system". Runs inline so
// there's no flash of the wrong theme; the Settings page updates data-theme-pref directly.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement;var m=window.matchMedia('(prefers-color-scheme: dark)');function apply(){var p=d.getAttribute('data-theme-pref')||'system';d.setAttribute('data-theme',p==='system'?(m.matches?'dark':'light'):p);}apply();m.addEventListener('change',apply);}catch(e){}})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const userId = await requireUserId();
  const pref = userId
    ? await prisma.userPreference.findUnique({ where: { userId }, select: { theme: true, density: true } })
    : null;
  const themePref = pref?.theme === "light" || pref?.theme === "dark" ? pref.theme : "system";
  const density = pref?.density === "compact" ? "compact" : "comfortable";

  return (
    <html
      lang="en"
      data-theme-pref={themePref}
      data-theme={themePref === "system" ? undefined : themePref}
      data-density={density}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
