# Desktop Native Bridge

`apps/desktop` loads the existing daemon-served Web UI with `loadURL(http://127.0.0.1:<port>/)`.
Business data and commands continue to use daemon HTTP/SSE. The preload bridge only exposes local
desktop capabilities that cannot be provided by the browser.

## Preload API Whitelist

The preload script exposes `window.agentHubDesktop` with only these methods:

- `openDirectoryPicker()`
- `openFilePicker()`
- `showNotification({ title, body })`
- `openPath({ path })`
- `openExternal({ url })`
- `getDaemonStatus()`
- `restartDaemon()`
- `exportLogs()`

There is no generic IPC invoke/send API exposed to the renderer. New native capabilities must be
added to this whitelist and reviewed before use.

## Security Baseline

- `contextIsolation: true`
- `nodeIntegration: false`
- No `loadFile` fallback for the Web UI
- External links are opened with the system browser
- `openExternal` is limited to `http:`, `https:`, and `mailto:`
- `openPath` requires the target path to exist
