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
    const botValue =
      process.env.NEXT_PUBLIC_TG_BOT_USERNAME ??
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
      process.env.TELEGRAM_BOT_USERNAME ??
      DEMO_BOT_USERNAME;
    // Agent backend (bemguide-chat) base URL. Consumers read
    // `NEXT_PUBLIC_AGENT_BASE_URL`; we accept the bare server-only
    // `AGENT_BASE_URL` as a fallback so the same value works whether
    // ops set the public or private name. Empty when unset → the
    // assistant tab and screen hide themselves at runtime.
    const agentBaseUrl =
      process.env.NEXT_PUBLIC_AGENT_BASE_URL ??
      process.env.AGENT_BASE_URL ??
      "";
    return {
      NEXT_PUBLIC_TG_BOT_USERNAME: botValue,
      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: botValue,
      NEXT_PUBLIC_AGENT_BASE_URL: agentBaseUrl,
    };
  })(),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // picsum.photos 302-redirects every image to fastly.picsum.photos.
      // Next/image's optimizer revalidates the FINAL hostname against
      // remotePatterns, so we need both the entry host and its CDN
      // subdomains — bare `picsum.photos` alone produced 400s on every
      // seed thumbnail.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "**.picsum.photos" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // Admin-pasted image URLs sometimes come from Flickr, used in the
      // wild for places/health resources. Allowlist the static CDN tree
      // (`live.staticflickr.com`, `farm{N}.staticflickr.com`,
      // `c{N}.staticflickr.com`) so Next/image's optimizer doesn't 400
      // them. Long-term: pipe admin uploads through Supabase Storage and
      // drop these foreign hosts.
      { protocol: "https", hostname: "**.staticflickr.com" },
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
