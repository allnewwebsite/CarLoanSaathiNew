import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "react";
          }
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            if (id.includes("app-check")) return "firebase-app-check";
            if (id.includes("/auth") || id.includes("\\auth")) return "firebase-auth";
            if (id.includes("/storage") || id.includes("\\storage")) return "firebase-storage";
            return "firebase-core";
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
