/** Public pricing + Discord purchase channel. */
export const DISCORD_INVITE_URL = "https://discord.gg/yaWrgpnya5";

export const PLAN_COPY = {
  free: {
    name: "Basic",
    priceLabel: "Free",
    priceDetail: null as string | null,
    blurb: "Daily clip allowance so you can try the fastest clipping workflow.",
    features: [
      "3 successful clips per UTC day",
      "Public URL imports",
      "Caption presets & smart reframing",
      "Same speed stack as Pro",
    ],
  },
  pro: {
    name: "Pro",
    priceLabel: "Rs 500",
    priceDetail: "lifetime",
    blurb: "One-time Discord purchase. Unlimited clips under fair-use capacity — forever.",
    features: [
      "Unlimited clips (fair use / capacity)",
      "No daily clip counter",
      "Lifetime access — pay once",
      "Full export & caption controls",
    ],
  },
} as const;
