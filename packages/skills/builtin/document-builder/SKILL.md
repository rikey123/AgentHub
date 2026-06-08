---
name: document-builder
description: Build Markdown document artifacts with YAML frontmatter.
artifact_kind: document
---

# Document Builder

Use this skill when the user asks for a report, plan, memo, specification, article, guide, or structured Markdown document.

## Output Contract

- Produce Markdown, not HTML.
- Start with YAML frontmatter containing `title`, `date`, `author`, and `tags`.
- Use clear headings, concise prose, and tables where they improve scanability.
- Do not include unsupported remote embeds.
- Submit the artifact with `room.publish_artifact({ kind: "document", content, filename })`.
