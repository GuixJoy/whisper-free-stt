/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#05070B",
          surface: "#0A0D12",
          "surface-secondary": "#11161D",
          sidebar: "#080B10",
          hover: "#141A22",
          "surface-card": "#0F131A",
          "surface-dark": "#0C1016",
        },
        text: {
          primary: "#F7F4EE",
          secondary: "#B9B4AB",
          muted: "#7A7F87",
          disabled: "#4A4F57",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.06)",
          hover: "rgba(255,255,255,0.10)",
          accent: "rgba(199,119,44,0.15)",
        },
        accent: {
          DEFAULT: "#C7772C",
          hover: "#DD8B3A",
          glow: "rgba(199,119,44,0.25)",
          muted: "rgba(199,119,44,0.12)",
          "muted-border": "rgba(199,119,44,0.25)",
          light: "#F3C68D",
          bright: "#F6B15F",
          warm: "#D88A3A",
        },
        success: "#16A34A",
        time: "#9CA3AF",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        "page-title": ["32px", { lineHeight: "40px", fontWeight: "600" }],
        "section-heading": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "card-heading": ["18px", { lineHeight: "26px", fontWeight: "600" }],
        body: ["15px", { lineHeight: "24px", fontWeight: "400" }],
        small: ["13px", { lineHeight: "20px", fontWeight: "400" }],
        label: ["12px", { lineHeight: "16px", fontWeight: "600", letterSpacing: "0.04em" }],
        stat: ["52px", { lineHeight: "1", fontWeight: "700" }],
        "hero-heading": ["48px", { lineHeight: "56px", fontWeight: "600" }],
      },
      borderRadius: {
        app: "28px",
        card: "24px",
        button: "14px",
        input: "14px",
        badge: "10px",
      },
      spacing: {
        "sidebar-width": "220px",
        "insight-width": "270px",
      },
      boxShadow: {
        DEFAULT: "0 1px 2px rgba(0,0,0,0.04)",
        ambient: "0 0 60px rgba(0,0,0,0.35)",
        "accent-glow": "0 0 40px rgba(199,119,44,0.08)",
        "accent-button": "0 0 30px rgba(199,119,44,0.25)",
      },
    },
  },
  plugins: [],
};
