
## W1C verification notes
- Initial verification failed before pnpm install because this worktree had no node_modules; pnpm.cmd install restored vitest, @types/node, chokidar, and gray-matter resolution.
- Chokidar v4 watcher tests need explicit watcher.close(), eventBus.close(), and sqlite.close() before temp directory cleanup on Windows to avoid EPERM.

## v05-w5-final cleanup notes
- TypeScript initially reported missing web dependencies because node_modules was absent in the worktree snapshot; reinstalling via pnpm.cmd fixed module resolution.
- One e2e lint cleanup had to preserve roomId bindings in tests that actually use them; only the truly unused binding was removed.
