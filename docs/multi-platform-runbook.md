# AgentHub multi-platform runbook

This runbook covers the current desktop and mobile surfaces for the multi-platform adaptation change.

## Ports

- Daemon and daemon-served Web UI: `http://127.0.0.1:6677`
- Mobile dev UI: `http://127.0.0.1:5174`

## Start the daemon

From the repository root:

```powershell
.\agenthub.cmd start
```

The default daemon bind is loopback only. This is the safest local development path.

## Desktop app

Build and run the Electron shell:

```powershell
pnpm.cmd --filter @agenthub/desktop build
pnpm.cmd --filter @agenthub/desktop start
```

The desktop renderer loads the daemon-served Web UI through `loadURL(http://127.0.0.1:<port>/)`. Business API traffic still goes through daemon HTTP routes, not IPC.

## Desktop Windows package

Build the Windows package:

```powershell
pnpm.cmd --filter @agenthub/desktop run package:dir
pnpm.cmd --filter @agenthub/desktop run dist
```

Outputs:

- `apps/desktop/release/win-unpacked/AgentHub.exe`
- `apps/desktop/release/AgentHub-0.0.0-win-x64.exe`

The Windows package is self-contained for local desktop use. It includes the Electron shell, the built Web assets, the daemon sidecar runtime, database migrations, built-in agent templates, and the room MCP bridge resources. A user should be able to install or open `AgentHub.exe` without checking out this repository or setting `AGENTHUB_SOURCE_ROOT`.

Auto-update is present as a disabled configuration skeleton. It does not contact any update server unless both variables are set:

```powershell
$env:AGENTHUB_DESKTOP_AUTO_UPDATE = "1"
$env:AGENTHUB_DESKTOP_UPDATE_URL = "https://updates.example.invalid/agenthub"
```

No public release feed is configured yet.

## Mobile local browser verification

Start the mobile dev UI:

```powershell
pnpm.cmd --filter @agenthub/mobile dev
```

Open:

```text
http://127.0.0.1:5174
```

Issue a mobile token:

```powershell
$issued = Invoke-RestMethod -Method Post http://127.0.0.1:6677/auth/tokens `
  -ContentType "application/json" `
  -Body '{"description":"mobile-local","scopes":["read","write"]}'
$issued.connection.qrPayload
```

Paste the returned `qrPayload` into the mobile QR payload box. In dev mode, the mobile browser app sends API requests to the Vite origin (`:5174`) and Vite proxies them to the daemon. This keeps browser validation same-origin while preserving daemon Bearer-token checks.

## Mobile LAN verification

Find the computer LAN IP:

```powershell
ipconfig
```

For a browser-based LAN smoke test, keep the daemon on loopback and expose only the Vite mobile dev server on the LAN. Browser mobile UI requests go to `http://<lan-ip>:5174/...`; Vite proxies them to `http://127.0.0.1:6677/...`.

Start the mobile dev server on all interfaces:

```powershell
pnpm.cmd --filter @agenthub/mobile exec vite --host 0.0.0.0 --port 5174
```

Open this URL on the phone while it is on the same Wi-Fi:

```text
http://192.168.1.10:5174
```

Issue a mobile token from an authenticated desktop/Web/CLI context and import the `qrPayload`. The mobile token should include `read,write` if reply and approval actions need to be verified.

If a future native/hybrid mobile shell connects directly to the daemon instead of going through the Vite proxy, configure the daemon to bind that LAN IP with token protection and remote access enabled. The exact config file path depends on the local AgentHub config in use; the required values are:

```toml
[server]
bind = "192.168.1.10"
port = 6677

[server.remote]
enabled = true

[auth]
token = "replace-with-admin-token"
```

Direct browser-to-daemon calls from `http://<lan-ip>:5174` to `http://<lan-ip>:6677` are not the supported verification path. Browser requests carry an `Origin` header, and daemon Origin validation runs before Bearer-token validation. Native mobile HTTP clients usually omit `Origin` and can use Bearer directly.

## Android app (Capacitor)

The mobile UI ships as an Android app via Capacitor: the same `apps/mobile` Vite/React build is wrapped in a native shell. On a device, SDK requests go through the **CapacitorHttp** native HTTP client (`apps/mobile/src/nativeHttp.ts`), which carries no browser `Origin` header — so the daemon authenticates the app purely by Bearer token and never hits its Origin-before-Bearer 403 path. This is why the Android app can connect straight to `http://<lan-ip>:6677` (no Vite proxy needed on device).

### Prerequisites (one-time, on the build machine)

- Android Studio (bundles the Android SDK) or a standalone Android SDK + command-line tools
- JDK 17+
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and `JAVA_HOME` set; `adb` on `PATH`

### First-time native project scaffold

From the repo root:

```powershell
pnpm.cmd --filter @agenthub/mobile run build          # produces apps/mobile/dist
pnpm.cmd --filter @agenthub/mobile run cap:add:android # creates apps/mobile/android (one-time)
pnpm.cmd --filter @agenthub/mobile run cap:sync        # build + copy web assets into android
```

`cap add android` generates the `apps/mobile/android` Gradle project from `capacitor.config.ts`
(`appId: dev.agenthub.mobile`, `webDir: dist`, `CapacitorHttp` enabled, cleartext http allowed for
the LAN daemon).

### Produce / run the apk

```powershell
# Build a debug apk (output under apps/mobile/android/app/build/outputs/apk/)
pnpm.cmd --filter @agenthub/mobile run android:apk

# Or build+install+launch on a connected device / emulator
pnpm.cmd --filter @agenthub/mobile run android:run

# Or open in Android Studio to build a signed release apk/aab
pnpm.cmd --filter @agenthub/mobile run cap:open:android
```

After any web-side change, re-run `cap:sync` (it rebuilds `dist` and copies it into the Android
project) before rebuilding the apk.

### Connecting from the device

1. Keep the daemon reachable on the LAN (bind a LAN IP with `token` + `server.remote.enabled = true`; see "Mobile LAN verification").
2. On the phone (same Wi-Fi), open the app and import the connection config (QR payload or manual host/port/token) generated from an authenticated desktop/Web/CLI context.
3. The app talks to `http://<lan-ip>:6677` via native HTTP with the Bearer token.

### Notes

- A debug apk is unsigned for ad-hoc/internal install (enable "install from unknown sources"). A signed release apk/aab needs a keystore — build it via Android Studio's signed-bundle flow or a configured Gradle signing config; that keystore is yours to provide, not committed.
- This repo provides the Capacitor integration and build scripts; the actual apk must be built on a machine with the Android toolchain installed (the apk artifact is not produced by the JS test/build pipeline).

## Mobile weak-network behavior

The mobile client stores the last event cursor in `localStorage`, keeps the last successful snapshot on screen, and uses the SDK JSON polling channel for reconnect and durable replay:

- Snapshot refresh failures show `offline` or `error` without clearing rooms/tasks/runs.
- Reconnect resumes from the stored cursor.
- Message sends use an `idempotencyKey`.
- Permission decisions use an `idempotencyKey` and refresh snapshot state after first-wins resolution.

## Current packaging boundary

The desktop app builds into a self-contained Windows package: it bundles a daemon sidecar, the built Web UI, DB migrations, agent templates, the room MCP bridge, a built-in Node runtime, and the daemon's native deps. It does not require the source tree, `AGENTHUB_SOURCE_ROOT`, or a user-installed Node.

```powershell
pnpm.cmd --filter @agenthub/desktop run package:dir   # unpacked app dir (release/win-unpacked)
pnpm.cmd --filter @agenthub/desktop run dist           # NSIS installer
pnpm.cmd --filter @agenthub/mobile build
```

At runtime the packaged Electron main process spawns the daemon through the bundled Node
(`resources/agenthub-node/node.exe`) running `resources/agenthub-daemon/daemon-sidecar.mjs`, and
injects every resource directory explicitly (`--web-assets-root`, `--migrations-dir`,
`--agent-templates-dir`, `--room-mcp-bridge-dir`). The daemon's native deps (better-sqlite3 etc.)
ship as a real `resources/agenthub-daemon/node_modules` next to the bundle so Node ESM resolves the
bare imports. Packaged-vs-dev is decided by `app.isPackaged` injected from the main process, not by
probing `process.resourcesPath` at spawn time.

Verified portable: copying `release/win-unpacked` to a directory **outside the source tree** and
launching `AgentHub.exe` there starts the daemon (`GET /healthz` 200, `/` and `/rooms` 200) and the
renderer loads the daemon-served Web UI same-origin. No source tree, `AGENTHUB_SOURCE_ROOT`, or
user-installed Node required.

Known caveats / not yet done:

- `electron-builder.yml` uses `asar: true`. App code is packed into `resources/app.asar`; the daemon spawn targets (`node.exe`, `daemon-sidecar.mjs`, the daemon `node_modules`, web/migrations/templates/mcp dirs) ship as real `extraResources` outside the archive (the bundled Node cannot execute files inside an asar). Verified portable with asar on: copied outside the source tree, `AgentHub.exe` starts the daemon and serves the UI.
- Code signing is **config-ready but unsigned by default**. `win.signtoolOptions` is set and electron-builder reads standard `CSC_LINK` / `CSC_KEY_PASSWORD` env vars; with no cert present (the default) packaging proceeds unsigned. To remove the Windows "unknown publisher" / SmartScreen warning for public distribution, supply a CA-issued (or EV) code-signing certificate via those env vars before `dist`. Self-signed certs do not clear SmartScreen and have no distribution trust value, so signing is not done for local/internal use.
- Mobile installable artifacts still need a native/hybrid wrapper such as Android WebView/Capacitor/Expo plus a configured Android SDK or iOS build environment.

