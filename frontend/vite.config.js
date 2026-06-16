import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "react";
          }
          if (id.includes("node_modules/firebase")) {
            return "firebase";
          }
          if (id.includes("node_modules/axios")) {
            return "axios";
          }
          if (id.includes("node_modules/recharts")) {
            return "charts";
          }
          if (id.includes("/src/services/") || id.includes("/src/hooks/")) {
            return "app-runtime";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
