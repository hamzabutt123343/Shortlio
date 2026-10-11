import type { Metadata } from "next";
import { Anton, DM_Sans, Inter, Montserrat, Poppins, Roboto, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const montserrat = Montserrat({
  variable: "--font-caption-montserrat",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const anton = Anton({
  variable: "--font-caption-anton",
  subsets: ["latin"],
  weight: "400",
});

const poppins = Poppins({
  variable: "--font-caption-poppins",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-caption-inter",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const roboto = Roboto({
  variable: "--font-caption-roboto",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Shortlio — AI long-form to short-form clips",
  description:
    "Turn long videos into engaging Shorts, TikToks, and Reels with transcript-first analysis, smart reframing, and animated captions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmSans.variable} ${montserrat.variable} ${anton.variable} ${poppins.variable} ${inter.variable} ${roboto.variable} h-full`}
    >
      <body className="min-h-full flex flex-col font-sans antialiased">{children}</body>
    </html>
  );
}
