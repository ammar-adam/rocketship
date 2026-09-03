import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/ui/TopNav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RocketShip - Stock Discovery",
  description: "Multi-agent AI stock discovery system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
      <body className={inter.className}>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
