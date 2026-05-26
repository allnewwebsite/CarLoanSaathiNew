/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101828",
        muted: "#667085",
        line: "#E4E7EC",
        surface: "#F5F7FB",
        brand: {
          50: "#EAF2FF",
          100: "#D7E8FF",
          500: "#1565C0",
          600: "#0D47A1",
          700: "#083B86"
        },
        navy: "#172554",
        gold: "#D6A83A"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 24, 40, 0.08)",
        panel: "0 10px 28px rgba(16, 24, 40, 0.07)"
      }
    },
  },
  plugins: [],
};
