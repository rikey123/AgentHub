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

  test("tells leaders to publish long synthesis deliverables as file messages", () => {
    const prompt = buildLeaderPrompt({
      agentName: "Project Manager",
      teammates: [
        { agentId: "agent_builder", name: "Builder", slug: "builder", role: "teammate", presence: "active" }
      ]
    });

    expect(prompt).toContain("room.send_file_message");
    expect(prompt).toContain("short public summary");
    expect(prompt).toContain("file card");
  });

  test("includes V1.2 artifact publishing, aggregate wake, restart recovery, and PPTX guidance", () => {
    const prompt = buildLeaderPrompt({
      agentName: "Project Manager",
      teammates: [
        { agentId: "agent_builder", name: "Builder", slug: "builder", role: "teammate", presence: "active" }
      ]
    });

    expect(prompt).toContain("room.publish_artifact");
    expect(prompt).toContain("keep the chat message to a short note plus the artifact reference");
    expect(prompt).toContain("reason `aggregate`");
    expect(prompt).toContain("reason `restart_recovery`");
    expect(prompt).toContain("officecli-pptx");
    expect(prompt).toContain("kind: \"presentation_pptx\"");
  });

  test("uses attributed synthesis and visible handoff language without bypassing review", () => {
    const prompt = buildLeaderPrompt({
      agentName: "Project Manager",
      teammates: [
        { agentId: "agent_builder", name: "Builder", slug: "builder", role: "teammate", presence: "active" },
        { agentId: "agent_reviewer", name: "Reviewer", slug: "reviewer", role: "teammate", presence: "idle" }
      ]
    });

    expect(prompt).toContain("attribute contributions by teammate name");
    expect(prompt).toContain("Builder found");
    expect(prompt).toContain("Reviewer flagged");
    expect(prompt).toContain("brief public handoff line");
    expect(prompt).toContain("who is taking which angle");
    expect(prompt).toContain("The system also mirrors task lifecycle milestones into short public room messages");
    expect(prompt).toContain("Do not repeat those lifecycle updates mechanically");
    expect(prompt).toContain("do not present teammate output as final until review is complete");
    expect(prompt).toContain("ready for review");
    expect(prompt).toContain("under review");
  });
});
