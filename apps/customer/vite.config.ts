import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"

export default defineConfig({
  plugins: [tanstackStart(), react()],
  server: {
    // Single-origin in dev: /api/* proxies to apps/api. Production uses a
    // reverse proxy with the same routing (see ADR 0001 topology).
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
})
