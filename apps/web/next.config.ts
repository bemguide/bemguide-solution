import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@poruch/shared"],
  // Expose the bot username to the client under both names the
  // codebase has used. Source priority:
  //   1. NEXT_PUBLIC_TG_BOT_USERNAME       (team convention)
  //   2. NEXT_PUBLIC_TELEGRAM_BOT_USERNAME  (older name)
  //   3. TELEGRAM_BOT_USERNAME              (the bare server-only
  //      value — matches the backend's env)
  //   4. DEMO_BOT_USERNAME fallback         (last resort so demo
  //      deploys without env config still get working share +
  //      create-chat buttons; bot usernames aren't secrets, the
  //      token is what matters and that is never hardcoded)
  // Both public names get the same resolved value, so consumers can
  // read whichever they prefer.
  env: (() => {
    const DEMO_BOT_USERNAME = "bembembem_testbot";
    const value =
      process.env.NEXT_PUBLIC_TG_BOT_USERNAME ??
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
      process.env.TELEGRAM_BOT_USERNAME ??
      DEMO_BOT_USERNAME;
    return {
      NEXT_PUBLIC_TG_BOT_USERNAME: value,
      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: value,
    };
  })(),
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
