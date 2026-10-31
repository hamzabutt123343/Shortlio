/** Webpack / production CSS pipeline (Turbopack still uses @tailwindcss/turbopack). */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
