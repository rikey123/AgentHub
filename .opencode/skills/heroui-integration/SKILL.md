---
name: heroui-integration
description: Use HeroUI as the shared UI system for AgentHub React workbench surfaces. Prefer HeroUI primitives and layouts over bespoke per-component styling.
---

# HeroUI Integration for AgentHub

## Goal

Build AgentHub's web UI on top of HeroUI primitives and patterns instead of hand-writing ad hoc component styles in each page component.

## Current stack

- React 19
- Vite
- TypeScript
- HeroUI React
- Tailwind CSS v4 via HeroUI guidance
- Existing data flow from the daemon/projector hooks

## What to use HeroUI for

Prefer HeroUI components for:

- app shell and page structure
- tabs
- drawer / slide-over surfaces
- cards and surfaces
- buttons and icon buttons
- badges / chips / counters
- popovers / tooltips / autocomplete
- scroll containers and empty states
- modal dialogs and command palettes

## Working rules

1. Keep the current four-column workbench structure unless the task explicitly says otherwise.
2. Keep the daemon/projector data flow intact. HeroUI changes the view layer, not the backend contract.
3. Reuse shared UI primitives instead of writing new inline styles in each business component.
4. If a HeroUI component can express the interaction, use it before building a custom element.
5. If a required control does not exist yet, add it to a shared UI layer first, then consume it from pages.
6. Keep room, run detail, pending turn, and cost surfaces visually consistent.
7. Prefer composition over page-local style objects.

## Recommended implementation order

1. Wire HeroUI provider and base styles.
2. Convert the app shell / layout surface.
3. Convert the home view and room list.
4. Convert side panels and run detail tabs.
5. Replace remaining custom chrome only where HeroUI covers the need.

## Anti-patterns

- Do not keep inventing new one-off card, tab, button, and empty-state styles in business components.
- Do not change the backend event or API contract just to fit the UI library.
- Do not turn the workbench into a marketing page.
- Do not replace the four-column layout with a completely different product shape unless the task explicitly requires it.

## Practical guidance

- Use HeroUI for the visible shell and interaction affordances.
- Keep the app's own tokens only for brand-level adjustments and cross-surface consistency.
- If a HeroUI component is a better fit than the current custom one, swap it in at the shared component layer, not in every page.
- Use the llms guidance below when asking a coding agent to work on this UI.

## LLM guidance

- Follow the existing workbench structure.
- Minimize bespoke styling in page components.
- Prefer reusable HeroUI surfaces, tabs, drawers, buttons, and badges.
- Keep the interface dense, utilitarian, and easy to scan.
- Make discoverable home, room, run detail, pending turn, and cost surfaces.

