import { describe, expect, test } from "vitest";

import { buildLeaderPrompt } from "../src/prompts/lead-prompt.ts";

describe("buildLeaderPrompt", () => {
  test("directs leaders to delegate work through room.delegate instead of chat messages", () => {
    const prompt = buildLeaderPrompt({
      agentName: "Project Manager",
      teammates: [
        { agentId: "agent_builder", name: "Builder", slug: "builder", role: "teammate", presence: "active" }
      ]
    });

    expect(prompt).toContain("room.delegate");
    expect(prompt).toContain("expectsReview");
    expect(prompt).toContain("Task");
    expect(prompt).not.toContain("Assign tasks and notify teammates via `room.send_message @slug ...`");
    expect(prompt).not.toContain("Break work into tasks with `room.create_task`");
  });

  test("keeps public leader chat concise while long teammate work stays in task details", () => {
    const prompt = buildLeaderPrompt({
      agentName: "Project Manager",
      teammates: [
        { agentId: "agent_builder", name: "Builder", slug: "builder", role: "teammate", presence: "active" },
        { agentId: "agent_reviewer", name: "Reviewer", slug: "reviewer", role: "teammate", presence: "idle" }
      ]
    });

    expect(prompt).toContain("Public room chat should feel like a group chat");
    expect(prompt).toContain("Keep visible chat replies short");
    expect(prompt).toContain("Detailed teammate work belongs in Task status, completion summaries, or run details");
    expect(prompt).toContain("Delegation instructions should be terse");
    expect(prompt).toContain("Do not paste long teammate reports into the room chat");
  });
});
