export type BuiltinSkillDefinition = {
  readonly name: string;
  readonly description: string;
  readonly content: string;
};

export const BUILTIN_SKILLS: readonly BuiltinSkillDefinition[] = [
  {
    name: "task-planner",
    description: "Helps agents break complex work into well-defined tasks with clear dependencies and assignee roles.",
    content: `---
name: task-planner
description: Helps agents break complex work into well-defined tasks with clear dependencies and assignee roles.
---

# Task Planner

When you receive a complex request, break it down into concrete tasks before delegating.

## Task Structure
Each task should have:
- A clear, actionable title
- A description of what needs to be done
- An assignee role (not agent ID)
- Dependencies on other tasks (if any)
- An estimated turn limit (optional)

## Planning Guidelines
1. Identify the main deliverable
2. Break into independent subtasks where possible
3. Identify dependencies between tasks
4. Assign each task to the most appropriate role
5. Set realistic turn limits for complex tasks

## Output Format
Produce a PlanDocument JSON block when in planning phase.
`
  },
  {
    name: "skill-creator",
    description: "Helps users create new skills in the standard SKILL.md format.",
    content: `---
name: skill-creator
description: Helps users create new skills in the standard SKILL.md format.
---

# Skill Creator

Help users create new skills for AgentHub agents.

## SKILL.md Format
A skill package consists of:
- \`SKILL.md\`: Main skill file with YAML frontmatter and instructions
- Optional supporting files in subdirectories

## Frontmatter
\`\`\`yaml
---
name: skill-name
description: One-line description of what this skill does
---
\`\`\`

## Instructions
Write clear, actionable instructions that tell the agent:
1. When to use this skill
2. How to apply it
3. What output to produce

## Best Practices
- Keep skills focused on a single capability
- Include examples where helpful
- Reference specific tools or patterns the agent should use
`
  },
  {
    name: "web-page-builder",
    description: "Builds a single-file, self-contained responsive HTML web page artifact.",
    content: `---
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
- Submit the artifact with \`room.publish_artifact({ kind: "web_page", content, filename })\`.
`
  },
  {
    name: "web-app-builder",
    description: "Builds a single-file browser app artifact with inline JavaScript and localStorage persistence.",
    content: `---
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
- Submit the artifact with \`room.publish_artifact({ kind: "web_app", content, filename })\`.
`
  },
  {
    name: "one-pager-builder",
    description: "Builds a printable one-page business brief as a self-contained HTML artifact.",
    content: `---
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
- Submit the artifact with \`room.publish_artifact({ kind: "web_page", content, filename })\`.
`
  },
  {
    name: "html-slides-builder",
    description: "Builds keyboard-navigable HTML slide decks as presentation artifacts.",
    content: `---
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
- Mark slide boundaries clearly, preferably with \`<!-- slide-N -->\` comments so slides can be referenced.
- Submit the artifact with \`room.publish_artifact({ kind: "presentation", content, filename })\`.
`
  },
  {
    name: "document-builder",
    description: "Builds Markdown document artifacts with YAML frontmatter.",
    content: `---
name: document-builder
description: Build Markdown document artifacts with YAML frontmatter.
artifact_kind: document
---

# Document Builder

Use this skill when the user asks for a report, plan, memo, specification, article, guide, or structured Markdown document.

## Output Contract
- Produce Markdown, not HTML.
- Start with YAML frontmatter containing \`title\`, \`date\`, \`author\`, and \`tags\`.
- Use clear headings, concise prose, and tables where they improve scanability.
- Do not include unsupported remote embeds.
- Submit the artifact with \`room.publish_artifact({ kind: "document", content, filename })\`.
`
  },
  {
    name: "officecli-pptx",
    description: "Creates or edits real PPTX files with officecli and publishes them as presentation_pptx artifacts.",
    content: `---
name: officecli-pptx
description: Create or edit real PPTX files with officecli and publish them as presentation_pptx artifacts.
artifact_kind: presentation_pptx
---

# OfficeCLI PPTX

Use this skill when the user specifically needs a real PowerPoint, PPTX, PPT, or ODP file rather than HTML slides.

## Workflow
1. Create or edit the deck on disk using \`officecli\`.
2. Inspect structure with \`officecli view "$FILE" outline\`.
3. Inspect slide text with \`officecli view "$FILE" text --start N --end N\`.
4. Inspect slide XML when needed with \`officecli get "$FILE" "/slide[N]"\`.
5. Render slides for validation with \`officecli view "$FILE" svg --start N --end N\`.
6. Validate before publishing with \`officecli validate "$FILE"\`.
7. Publish with \`room.publish_artifact({ kind: "presentation_pptx", filePath, filename, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })\`.

Do not use an \`extract-slide\` command; use the supported \`view\` and \`get\` commands above.
`
  }
] as const;
