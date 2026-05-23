# AgentHub Security

AgentHub is local-first and binds to `127.0.0.1` by default. Browser access is still authenticated: mutating routes require allowed `Origin`, matching `Host`, `Content-Type: application/json`, an HttpOnly `agenthub_session` cookie, and `X-Agenthub-CSRF`. GET and SSE routes require the browser session plus Origin/Host checks, but no CSRF header because native `EventSource` cannot set custom headers. Bearer tokens do not bypass hostile browser Origins.

Secrets are protected by `SecretRedactor`, which redacts Bearer tokens, Anthropic/OpenAI/GitHub/AWS/JWT-like values, AgentHub token lines, env secret lines, URL userinfo, user patterns, and known keychain literals. Redaction is fail-closed: errors produce `«REDACTOR_ERROR»` placeholders rather than raw output.

Filesystem inputs use canonical workspace path and URI checks. `file://` resolves through workspace/attachment/run roots, `data:` is MIME and size limited, SVG is sanitized, and absolute paths are not exposed to agents except in authorized raw/admin debug surfaces. Worktree GC only scans AgentHub-managed roots under `<userhome>/.agenthub`, skips symlink escapes/in-flight artifacts/non-terminal runs, and uses `git worktree remove --force` for worktrees.
