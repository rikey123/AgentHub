# Permission Profiles

Permission profiles define default `allow`, `ask`, or `deny` behavior for file, shell, tool, context, and agent resources.

Built-in MVP profiles:

- `builder-strict`: reads allowed; writes/deletes and shell/tools ask; memory writes denied.
- `builder-loose`: common local test/git commands allowed; risky operations still ask.
- `read-only`: file writes/deletes and shell denied; tool usage asks.

Sensitive file patterns such as `.env`, private keys, cloud credentials, `.ssh`, `.netrc`, and service-account JSON are deny-first. Agent-provided prompt content never upgrades permissions; every elevated action still goes through `PermissionEngine` and emits an audit event.
