import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth"],
          firestore: ["firebase/firestore", "firebase/storage"],
          axios: ["axios"],
          icons: ["lucide-react"],
          motion: ["framer-motion"],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
