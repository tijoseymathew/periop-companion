/**
 * Semantic token pattern per specs/ui.md §6. Values track the imported
 * "PeriOp Companion.dc.html" design: a near-black slate canvas, a teal brand
 * accent (deliberately not green), and the five-state verification-status
 * palette. Token *names* stay semantic so component classes survive a reskin.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "#0d1117", // app canvas
          chrome: "#10151c", // stepper / nav chrome
          raised: "#141a22", // cards
          sunken: "#0f141b", // source panel
          overlay: "#1e2732", // chrome borders / dividers
          line: "#232d38", // card borders
        },
        ink: {
          primary: "#e6ecf3",
          secondary: "#9fb0c0",
          subtle: "#6a7889",
          faint: "#5b6879",
          onBrand: "#07110f", // text on a teal fill
        },
        brand: {
          DEFAULT: "#2dd4bf",
          soft: "#5fe3d3",
        },
        status: {
          supported: "#4ac776",
          unsupported: "#e3ab3f",
          conflicting: "#f26a60",
          inference: "#b28bf5",
          unverified: "#8ea0b2",
        },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        recPulse: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(242,106,96,.55)" },
          "50%": { boxShadow: "0 0 0 16px rgba(242,106,96,0)" },
        },
        barflow: {
          "0%,100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        recPulse: "recPulse 2s ease-out infinite",
        barflow: "barflow 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
