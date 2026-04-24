import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        raised: "var(--bg-raised)",
        sunken: "var(--bg-sunken)",
        hover: "var(--bg-hover)",
        pressed: "var(--bg-pressed)",
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          faint: "var(--border-faint)",
        },
        foreground: "var(--text)",
        muted: "var(--text-muted)",
        faint: "var(--text-faint)",
        inverted: "var(--text-inverted)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          faint: "var(--accent-faint)",
          on: "var(--accent-on)",
        },
        status: {
          ok: "var(--status-ok)",
          "ok-bg": "var(--status-ok-bg)",
          running: "var(--status-running)",
          "running-bg": "var(--status-running-bg)",
          err: "var(--status-err)",
          "err-bg": "var(--status-err-bg)",
          queued: "var(--status-queued)",
          "queued-bg": "var(--status-queued-bg)",
        },
        neutral: {
          0: "var(--n-0)",
          25: "var(--n-25)",
          50: "var(--n-50)",
          100: "var(--n-100)",
          150: "var(--n-150)",
          200: "var(--n-200)",
          300: "var(--n-300)",
          400: "var(--n-400)",
          500: "var(--n-500)",
          600: "var(--n-600)",
          700: "var(--n-700)",
          800: "var(--n-800)",
          900: "var(--n-900)",
        },
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        popover: "var(--shadow-popover)",
      },
      fontFamily: {
        sans: ["var(--f-ui)"],
        mono: ["var(--f-mono)"],
        serif: ["var(--f-serif)"],
      },
      spacing: {
        "d-row": "var(--d-row)",
        "d-input": "var(--d-input)",
        "d-pad": "var(--d-pad)",
        "d-gap": "var(--d-gap)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        spin: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        "fade-in": "fade-in 0.24s ease both",
        "fade-up": "fade-up 0.32s ease both",
        "pulse-subtle": "pulse-subtle 1.6s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
