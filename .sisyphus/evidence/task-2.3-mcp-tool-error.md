# task-2.3-mcp-tool-error

- Initial implementation used AI SDK schema helpers that pulled in a missing `zod` runtime dependency.
- Fixed by switching to plain tool objects so the converter stays thin and dependency-light.
- Final package test run passed after the converter change.
