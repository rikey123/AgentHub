---
name: web-app-builder
description: Build a single-file browser app artifact with inline JavaScript and localStorage persistence.
artifact_kind: web_app
---

# Web App Builder

Use this skill when the user asks for an interactive browser tool, small app, calculator, dashboard, game, editor, or workflow UI.

## Output Contract

- Produce one complete HTML document with inline CSS and JavaScript.
- Do not use external network resources.
- Persist user state with localStorage when the app has editable or repeat-use state.
- Include complete controls, empty states, and error states needed for the requested workflow.
- Submit the artifact with `room.publish_artifact({ kind: "web_app", content, filename })`.
