---
name: html-slides-builder
description: Build keyboard-navigable HTML slide decks as presentation artifacts.
artifact_kind: presentation
---

# HTML Slides Builder

Use this skill when the user asks for slides, a deck, a presentation, or a talk that can be delivered in a browser.

## Output Contract

- Produce one complete HTML document containing all slides.
- Inline CSS and JavaScript; do not use external dependencies.
- Support left/right keyboard navigation and touch navigation.
- Mark slide boundaries clearly, preferably with `<!-- slide-N -->` comments so slides can be referenced.
- Submit the artifact with `room.publish_artifact({ kind: "presentation", content, filename })`.
