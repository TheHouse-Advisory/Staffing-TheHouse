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
        // Paleta del sistema — espeja las CSS vars del mockup
        sidebar: {
          bg: "#1a1a2e",
          txt: "#a0a8c0",
          active: "#ffffff",
        },
        accent: "#1a1a1a",
        brand: "#4a90e2",
        // Escala de ocupación
        cap: {
          0: "#f0f0f0",
          low: "#dcf5e7",
          mid: "#fff4d4",
          hi: "#ffe4c4",
          full: "#ffd4d4",
          over: "#ffc0c0",
        },
        "cap-txt": {
          low: "#1e7e45",
          mid: "#8a6200",
          hi: "#c45000",
          full: "#c02020",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
