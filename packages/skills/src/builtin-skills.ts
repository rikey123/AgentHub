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
  }
] as const;
