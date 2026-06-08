---
name: one-pager-builder
description: Build a printable one-page business brief as a self-contained HTML artifact.
artifact_kind: web_page
---

# One-Pager Builder

Use this skill when the user asks for an executive brief, sales one-pager, project summary, proposal sheet, or concise business handout.

## Output Contract

- Produce one complete HTML document.
- Use a fixed, print-friendly one-page layout with clear sections and dense information hierarchy.
- Inline all CSS; avoid external dependencies and remote assets.
- Include print styles so the page prints cleanly on letter/A4.
- Submit the artifact with `room.publish_artifact({ kind: "web_page", content, filename })`.
