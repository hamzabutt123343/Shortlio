import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Shortlio — AI long-form to short-form clips",
    template: "%s · Shortlio",
  },
  description:
    "Turn long videos into engaging Shorts, TikToks, and Reels with transcript-first analysis, smart reframing, and animated captions.",
  applicationName: "Shortlio",
  icons: {
    icon: [{ url: "/brand/shortlio-icon.png", type: "image/png" }],
    apple: [{ url: "/brand/shortlio-icon.png" }],
    shortcut: "/brand/shortlio-icon.png",
  },
};

/**
 * Fonts load via CSS (globals.css) instead of next/font/google.
 * Turbopack in Next 16.4 hits "Can't resolve @vercel/turbopack-next/internal/font/google/font"
 * with multiple Google font faces — CSS link avoids that loader entirely.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:wght@400;500;600;700&family=Inter:wght@500;600;700&family=Montserrat:wght@500;700;800&family=Poppins:wght@600;700&family=Roboto:wght@500;700&family=Syne:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased">{children}</body>
    </html>
  );
}
