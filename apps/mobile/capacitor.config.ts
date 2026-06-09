import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.agenthub.mobile",
  appName: "AgentHub Mobile",
  webDir: "dist",
  // Route SDK requests through the native HTTP client (no browser Origin → daemon authenticates via
  // Bearer token, never hitting its Origin-before-Bearer 403 path). See src/nativeHttp.ts.
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  },
  server: {
    // The LAN daemon is served over plain http (http://<lan-ip>:6677), so cleartext must be allowed.
    // Native HTTP requests still carry the Bearer token; transport stays inside the user's LAN/VPN.
    androidScheme: "http",
    cleartext: true
  }
};

export default config;
