
## W1C verification notes
- Initial verification failed before pnpm install because this worktree had no node_modules; pnpm.cmd install restored vitest, @types/node, chokidar, and gray-matter resolution.
- Chokidar v4 watcher tests need explicit watcher.close(), eventBus.close(), and sqlite.close() before temp directory cleanup on Windows to avoid EPERM.
