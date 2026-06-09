import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const daemonTarget = process.env.AGENTHUB_MOBILE_PROXY_TARGET ?? "http://127.0.0.1:6677";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/sync": daemonTarget,
      "/mobile": daemonTarget,
      "/rooms": daemonTarget,
      "/permissions": daemonTarget,
      "/artifacts": daemonTarget,
      "/healthz": daemonTarget
    }
  }
});
