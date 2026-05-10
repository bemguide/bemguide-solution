import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Просвіт",
  description: "Знайди подію поруч.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF7F0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Telegram WebApp's script writes `--tg-viewport-*` CSS vars onto <html> and
    // `<body>` before React hydrates, which would otherwise abort hydration —
    // bail-out leaves the page interactive in markup but with no event handlers
    // attached, so every click silently does nothing. suppressHydrationWarning
    // tells React to keep going past the cosmetic style mismatch.
    <html lang="uk" className={cn("h-full antialiased", inter.variable)} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-full font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
