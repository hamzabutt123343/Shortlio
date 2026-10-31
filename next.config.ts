import type { NextConfig } from "next";
import path from "path";

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
  // Turbopack FS cache + CSS watching desktop/ was full-reloading the browser every ~1s.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/.git/**",
          "**/node_modules/**",
          "**/.next/**",
          "**/desktop/**",
          "**/worker/.venv/**",
          "**/worker/tmp/**",
          "**/worker/tmp_*/**",
        ],
      };
    }
    // Keep resolve rooted at the app (avoid picking up desktop/node_modules).
    config.resolve = config.resolve ?? {};
    config.resolve.modules = [
      path.resolve(process.cwd(), "node_modules"),
      "node_modules",
    ];
    return config;
  },
};

export default nextConfig;
