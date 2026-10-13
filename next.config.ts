import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow ngrok / tunnel hosts to load /__nextjs_font and other dev assets.
  // Hostnames only (no protocol/port). Restart `next dev` after changing this.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "**.ngrok-free.dev",
    "**.ngrok-free.app",
    "**.ngrok.io",
    "**.ngrok.app",
  ],
  // Auth/dashboard SaaS reads cookies on most routes; keep classic dynamic rendering.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
