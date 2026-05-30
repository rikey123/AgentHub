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
});
