## MODIFIED Requirements

### Requirement: daemon CLI 子命令

The CLI SHALL support the mature launcher commands:

```text
agenthub start
agenthub stop
agenthub status
agenthub doctor
agenthub web
agenthub -web
```

`agenthub web` and `agenthub -web` SHALL be callable from any project directory. The caller directory SHALL become the workspace root passed to the daemon. AgentHub internal scripts and web assets SHALL resolve from the installed/source AgentHub root, not from the caller directory.

If a daemon is already healthy, `agenthub web` SHALL reuse it. If not, it SHALL start the daemon first. In source/dev mode it SHALL run the web dev server from the AgentHub repo root. In built/packaged mode, if static web assets are available, it SHALL serve them through the daemon and open the daemon URL.

#### Scenario: Web launcher from arbitrary project

- **WHEN** the user runs `agenthub web` from `C:\project\test`
- **THEN** the daemon starts with `C:\project\test` as the workspace root
- **AND** AgentHub internal pnpm/web commands run from the AgentHub installation/source root
- **AND** the command does not fail with `ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE`

#### Scenario: Packaged web assets are served by daemon

- **WHEN** `agenthub web` finds built web assets under the configured or installed web assets root
- **THEN** it starts/reuses the daemon with `--web-assets-root` and opens the daemon URL instead of requiring a Vite dev server
