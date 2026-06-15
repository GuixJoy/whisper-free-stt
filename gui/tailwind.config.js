/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#000000",
          surface: "#050505",
          "surface-secondary": "#0a0a0a",
          sidebar: "#000000",
          hover: "#111111",
          "surface-card": "#050505",
          "surface-dark": "#030303",
        },
        text: {
          primary: "#f0ebe3",
          secondary: "#a8a096",
          muted: "#706a60",
          disabled: "#4a4540",
        },
        border: {
          DEFAULT: "rgba(255,240,220,0.06)",
          hover: "rgba(255,240,220,0.10)",
          accent: "rgba(200,130,50,0.15)",
        },
        accent: {
          DEFAULT: "#c88a32",
          hover: "#daa044",
          glow: "rgba(200,130,50,0.25)",
          muted: "rgba(200,130,50,0.12)",
          "muted-border": "rgba(200,130,50,0.25)",
          light: "#f0cc80",
          bright: "#e8a848",
          warm: "#d89438",
        },
        success: "#16A34A",
        time: "#908880",
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
        DEFAULT: "0 1px 2px rgba(0,0,0,0.08)",
        ambient: "0 0 60px rgba(0,0,0,0.4)",
        "accent-glow": "0 0 40px rgba(200,130,50,0.10)",
        "accent-button": "0 0 30px rgba(200,130,50,0.20)",
      },
    },
  },
  plugins: [],
};
