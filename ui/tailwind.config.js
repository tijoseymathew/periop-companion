/**
 * Semantic token pattern per specs/ui.md §6. Values track the imported
 * "PeriOp Catch-Up.dc.html" design: a warm paper canvas, a muted green brand
 * accent, a gold eyebrow accent, serif Newsreader for narrative + Public Sans
 * for everything else, and the five-state verification-status palette. Token
 * *names* stay semantic so component classes survive a reskin.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // warm paper surfaces
        surface: {
          base: "#FBF9F5", // app canvas
          chrome: "#FAF7F1", // headers / nav chrome
          raised: "#FBF9F5", // cards on the sunken rail
          sunken: "#F4EEE3", // right rail / intake fields
          panel: "#F1EBDF", // segmented control track
          warm: "#F7F1E6", // anticipated-issue cards
          overlay: "#E4DBCB", // card borders / dividers
          line: "#EFE8DA", // hairline row separators
          chromeline: "#E9E1D3", // header underlines
        },
        ink: {
          primary: "#23201B",
          body: "#33302a",
          secondary: "#6E675B",
          muted: "#5c564b",
          dim: "#8a8270",
          subtle: "#9a917f",
          faint: "#a49a87",
          ghost: "#b3a992",
          onBrand: "#FBF9F5", // text on a green fill
        },
        brand: {
          DEFAULT: "#2F6B5E", // fills
          ink: "#2A5F53", // links / on-paper text
          soft: "#3f7d6f",
        },
        gold: {
          DEFAULT: "#b0894a", // eyebrow / section labels
          soft: "#cdb98a",
        },
        status: {
          supported: "#5f8a52",
          unsupported: "#8A6D1E",
          conflicting: "#A24B2E",
          inference: "#5E6E8A",
          unverified: "#9a917f",
        },
      },
      fontFamily: {
        sans: ["'Public Sans'", "system-ui", "sans-serif"],
        serif: ["'Newsreader'", "Georgia", "serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        recPulse: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(162,75,46,.5)" },
          "50%": { boxShadow: "0 0 0 14px rgba(162,75,46,0)" },
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
