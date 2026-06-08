---
name: web-page-builder
description: Build a single-file, self-contained responsive HTML web page artifact.
artifact_kind: web_page
---

# Web Page Builder

Use this skill when the user asks for a landing page, static page, profile page, product page, report page, or other non-app web page.

## Output Contract

- Produce one complete HTML document.
- Inline all CSS and JavaScript in the document.
- Do not use external CDNs, remote fonts, remote images, or network dependencies.
- Make the page responsive and accessible with semantic landmarks, labels, and ARIA only where it clarifies behavior.
- Submit the artifact with `room.publish_artifact({ kind: "web_page", content, filename })`.
