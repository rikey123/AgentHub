import { describe, expect, test } from "vitest";

import { buildTeammatePrompt } from "../src/prompts/teammate-prompt.ts";

describe("buildTeammatePrompt", () => {
  test("keeps teammate public reports short and puts detailed work in task updates", () => {
    const prompt = buildTeammatePrompt({
      agentName: "Builder",
      leaderName: "Project Manager",
      leaderSlug: "project-manager",
      teammates: [
        { name: "Reviewer", slug: "reviewer", presence: "idle" }
      ]
    });

    expect(prompt).toContain("Public room messages should be short group-chat turns");
    expect(prompt).toContain("Use 1-3 short sentences");
    expect(prompt).toContain("Put detailed findings, long markdown, and deliverables into `room.update_task`");
    expect(prompt).toContain("Do not post a long report into room chat");
  });

  test("makes teammate replies feel like concrete group-chat follow-ups", () => {
    const prompt = buildTeammatePrompt({
      agentName: "Builder",
      leaderName: "Project Manager",
      leaderSlug: "project-manager",
      teammates: [
        { name: "Reviewer", slug: "reviewer", presence: "idle" }
      ]
    });

    expect(prompt).toContain("briefly reference the concrete request, result, or review point you are answering");
    expect(prompt).toContain("Avoid generic \"done\" messages");
    expect(prompt).toContain("one concrete outcome, blocker, or next decision");
  });
});
