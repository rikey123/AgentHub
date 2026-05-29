Per-run model permission decisions are cached in NativeAgentAdapter; repeated runs with the same runId/modelConfig reuse the stored decision and do not re-check permissions.
