import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@poruch/shared"],
  // Expose the bot username to the client. The `.env.local` we
  // already have only sets `TELEGRAM_BOT_USERNAME` (server-only),
  // and that's also what the backend uses, so we mirror it onto
  // a NEXT_PUBLIC_ name at build time instead of asking the user
  // to maintain two copies of the same value.
  env: {
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME:
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
      process.env.TELEGRAM_BOT_USERNAME ??
      "",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // TG profile photo URLs land on cdn4.cachefly.net or
      // t.me — keep `<img>` fallback in MeClient instead of next/image
      // for those, but allowlist common patterns just in case we
      // switch to <Image> later.
      { protocol: "https", hostname: "t.me" },
    ],
  },
  allowedDevOrigins: ["paleogenetic-carlie-punishingly.ngrok-free.dev"],
};

export default nextConfig;
