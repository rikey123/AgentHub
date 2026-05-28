# Task 1.3 Evidence — native-default runtime startup

- Command: `pnpm.cmd test -- packages/daemon`
- Result: `35 passed (35), 272 passed | 1 skipped (273)`
- Verified startup seeds `native-default` with `kind = native`, `name = AgentHub Native`, `supported_caps = []`, and `manifest_json = {"runtimeKind":"native"}`.
- Verified startup emits durable detail `runtime.detected` for `native-default`.
