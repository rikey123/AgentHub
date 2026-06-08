---
name: officecli-pptx
description: Create or edit real PPTX files with officecli and publish them as presentation_pptx artifacts.
artifact_kind: presentation_pptx
---

# OfficeCLI PPTX

Use this skill when the user specifically needs a real PowerPoint, PPTX, PPT, or ODP file rather than HTML slides.

## Workflow

1. Create or edit the deck on disk using `officecli`.
2. Inspect structure with `officecli view "$FILE" outline`.
3. Inspect slide text with `officecli view "$FILE" text --start N --end N`.
4. Inspect slide XML when needed with `officecli get "$FILE" "/slide[N]"`.
5. Render slides for validation with `officecli view "$FILE" svg --start N --end N`.
6. Validate before publishing with `officecli validate "$FILE"`.
7. Publish with `room.publish_artifact({ kind: "presentation_pptx", filePath, filename, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })`.

Do not use an `extract-slide` command; use the supported `view` and `get` commands above.
