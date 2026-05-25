
## W1C agent profile ownership
- Kept AgentProfile file parsing and watcher behavior in @agenthub/agents so daemon startup only bootstraps missing files, starts the watcher after EventBus creation, waits for the initial scan, and closes it during shutdown.
- agenthub agents reset --id=<agentId> is the only overwrite path for built-in templates; daemon bootstrap remains per-file existence based and never overwrites user-edited files.

## v05-w5-final verification decision
- Kept the fix scope limited to explicit typing and lint cleanup; no behavioral changes were introduced beyond removing dead code and aligning prop signatures.
