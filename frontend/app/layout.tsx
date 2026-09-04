import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/ui/TopNav";

// Instrument Serif for display, Instrument Sans for text, JetBrains Mono for
// numbers. next/font self-hosts and preloads these, so there is no external
// stylesheet round trip and no flash of fallback type.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RocketShip",
  description:
    "A multi-agent LLM stock screener, and an honest evaluation of whether it works.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        {/*
          Blocking, before first paint. The theme used to be applied in a
          useEffect inside ThemeToggle, so every dark-mode user got a white
          flash on every navigation. It also defaulted to light and ignored the
          OS entirely; `system` now actually tracks prefers-color-scheme.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('rocketship-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(p==='light'||p==='dark')?p:(d?'dark':'light');document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
