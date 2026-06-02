import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/auth": "http://127.0.0.1:6677",
      "/workspaces": "http://127.0.0.1:6677",
      "/attachments": "http://127.0.0.1:6677",
      "/event": "http://127.0.0.1:6677",
      "/rooms": "http://127.0.0.1:6677",
      "/roles": "http://127.0.0.1:6677",
      "/runtimes": "http://127.0.0.1:6677",
      "/model-configs": "http://127.0.0.1:6677",
      "/agent-bindings": "http://127.0.0.1:6677",
      "/settings": "http://127.0.0.1:6677",
      "/agents": "http://127.0.0.1:6677",
      "/runs": "http://127.0.0.1:6677",
      "/context": "http://127.0.0.1:6677",
      "/permissions": "http://127.0.0.1:6677",
      "/interventions": "http://127.0.0.1:6677",
      "/artifacts": "http://127.0.0.1:6677",
      "/debug": "http://127.0.0.1:6677",
      "/healthz": "http://127.0.0.1:6677",
      "/openapi.json": "http://127.0.0.1:6677",
      "/pending-turns": "http://127.0.0.1:6677",
      "/messages": "http://127.0.0.1:6677",
      "/tasks": "http://127.0.0.1:6677",
      "/mailbox": "http://127.0.0.1:6677",
      "/skills": "http://127.0.0.1:6677",
      "/board": "http://127.0.0.1:6677",
      "/timeline": "http://127.0.0.1:6677",
      "/scheduler": "http://127.0.0.1:6677",
      "/cron": "http://127.0.0.1:6677",
      "/recurring-tasks": "http://127.0.0.1:6677"
    }
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true
  }
});
