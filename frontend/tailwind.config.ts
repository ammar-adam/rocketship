import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral palette
        background: "#FAFAFA",
        foreground: "#171717",
        muted: "#737373",
        border: "#E5E5E5",
        
        // Accent (muted slate)
        accent: {
          DEFAULT: "#64748B",
          light: "#94A3B8",
          dark: "#475569"
        },
        
        // Semantic (verdicts)
        verdict: {
          enter: "#10B981",    // Green
          wait: "#F59E0B",     // Amber
          kill: "#EF4444"      // Red
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }]
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem"
      },
      borderRadius: {
        sm: "0.125rem",   // 2px
        DEFAULT: "0.25rem", // 4px
        lg: "0.5rem"      // 8px
      }
    },
  },
  plugins: [],
};

export default config;
