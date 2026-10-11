import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
