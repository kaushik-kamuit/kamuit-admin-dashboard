/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        kamuit: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#0BA26D",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        brand: {
          green: "#0BA26D",
          dark: "#059669",
          logo: "#12B981",
          mint: "#6EE7B7",
        },
        surface: {
          DEFAULT: "#f4f6f5",
          card: "#ffffff",
          sidebar: "#0f1117",
        },
      },
    },
  },
  plugins: [],
};
