# Agent Profiles

Agent profiles describe static agent identity and capabilities. MVP profiles are seeded for Mock agents and can be represented as markdown/frontmatter in later profile loading work.

Key fields:

- `id`, `name`, `adapter_id`, `model`
- `role_prompt` for the agent's base behavior
- `capabilities` such as `chat`, `code.edit`, `code.review`, `file.read`, `file.write`
- `permission_profile_id` to bind default permission behavior
- optional workspace mode preferences for future isolated worktree/copy selection

Profiles must honestly reflect adapter capabilities. Unsupported adapters remain deterministic stubs and must not pretend to provide real V1 behavior.
