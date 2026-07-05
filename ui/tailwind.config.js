/**
 * Semantic token pattern per specs/ui.md §6 — our own neutral slate values
 * and a teal brand accent (deliberately not green). Token *names* follow the
 * blueprint's semantic style; the values are ours (KUI theme values excluded,
 * ui.md §8).
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "#0f172a",
          raised: "#1e293b",
          sunken: "#0b1120",
          overlay: "#334155",
        },
        ink: {
          primary: "#f1f5f9",
          secondary: "#94a3b8",
          subtle: "#64748b",
        },
        brand: {
          DEFAULT: "#14b8a6",
          strong: "#0d9488",
          soft: "#5eead4",
        },
        status: {
          supported: "#22c55e",
          unsupported: "#f59e0b",
          conflicting: "#ef4444",
          inference: "#8b5cf6",
          unverified: "#64748b",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
