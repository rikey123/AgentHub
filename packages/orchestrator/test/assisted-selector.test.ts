import { describe, expect, test, vi } from "vitest";

import { AssistedSelectorGroupChatManager, type AssistedSelectorParticipant } from "../src/index.ts";

const participants: AssistedSelectorParticipant[] = [
  { agentId: "pm", name: "Project Manager", role: "primary", description: "Plans and synthesizes product work.", presence: "active", joinedAt: 1 },
  { agentId: "builder", name: "Builder", role: "teammate", description: "Builds software and architecture.", presence: "active", joinedAt: 2 },
  { agentId: "reviewer", name: "Reviewer", role: "teammate", description: "Reviews risks and tradeoffs.", presence: "active", joinedAt: 3 }
];

describe("AssistedSelectorGroupChatManager", () => {
  test("uses a model selector to choose the next speaker from candidates", async () => {
    const selectSpeaker = vi.fn(async () => "builder");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const selected = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "How should we design this platform?",
      participants,
      primaryAgentId: "pm"
    });

    expect(selected).toMatchObject({ agentId: "builder", reason: "selector" });
    expect(selectSpeaker).toHaveBeenCalledWith(expect.objectContaining({
      participants: expect.arrayContaining([expect.objectContaining({ agentId: "builder" })]),
      history: expect.stringContaining("User: How should we design this platform?")
    }));
  });

  test("mention override skips model selection", async () => {
    const selectSpeaker = vi.fn(async () => "pm");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const selected = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "@reviewer check this",
      participants,
      mentions: ["reviewer"],
      primaryAgentId: "pm"
    });

    expect(selected).toMatchObject({ agentId: "reviewer", reason: "selector_func" });
    expect(selectSpeaker).not.toHaveBeenCalled();
  });

  test("filters inactive participants and rejects repeated speakers by default", async () => {
    const selectSpeaker = vi.fn(async () => "reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const first = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants: [
        ...participants,
        { agentId: "observer", name: "Observer", role: "observer", description: "Should not speak.", presence: "observing", joinedAt: 4 }
      ],
      primaryAgentId: "pm"
    });
    expect(first).toMatchObject({ agentId: "reviewer" });

    selectSpeaker.mockResolvedValueOnce("builder");
    const second = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_reviewer",
      completedAgentId: "reviewer"
    });

    expect(second).toMatchObject({ agentId: "builder" });
    expect(selectSpeaker).toHaveBeenLastCalledWith(expect.objectContaining({
      participants: expect.not.arrayContaining([expect.objectContaining({ agentId: "reviewer" })])
    }));
  });

  test("retries invalid selector output and falls back to a valid candidate", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("ghost")
      .mockResolvedValueOnce("builder, reviewer")
      .mockResolvedValueOnce("");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker, maxSelectorAttempts: 3 });

    const selected = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Who should answer?",
      participants,
      primaryAgentId: "pm"
    });

    expect(selected).toMatchObject({ agentId: "pm", reason: "fallback" });
    expect(selectSpeaker).toHaveBeenCalledTimes(3);
  });

  test("retries with AutoGen-style feedback for invalid, multiple, and repeated selections", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("Project Manager")
      .mockResolvedValueOnce("ghost")
      .mockResolvedValueOnce("Project Manager and Builder")
      .mockResolvedValueOnce("Project Manager")
      .mockResolvedValueOnce("Reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker, maxSelectorAttempts: 4 });

    const first = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });
    expect(first).toMatchObject({ agentId: "pm" });

    const second = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_pm",
      completedAgentId: "pm"
    });

    expect(second).toMatchObject({ agentId: "reviewer", reason: "selector" });
    expect(selectSpeaker).toHaveBeenCalledTimes(5);
    expect(selectSpeaker.mock.calls[2]?.[0]).toMatchObject({
      attempt: 2,
      feedback: expect.stringContaining("No valid name was mentioned")
    });
    expect(selectSpeaker.mock.calls[3]?.[0]).toMatchObject({
      attempt: 3,
      feedback: expect.stringContaining("Expected exactly one name")
    });
    expect(selectSpeaker.mock.calls[4]?.[0]).toMatchObject({
      attempt: 4,
      feedback: expect.stringContaining("Repeated speaker is not allowed")
    });
  });

  test("matches speaker names with spaces and escaped underscores like AutoGen", async () => {
    const selectSpeaker = vi.fn(async () => "Story writer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const selected = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Who should write?",
      participants: [
        { agentId: "story_writer", name: "Story_writer", role: "teammate", description: "Writes stories.", presence: "active" },
        { agentId: "critic", name: "Critic", role: "teammate", description: "Reviews stories.", presence: "active" }
      ],
      primaryAgentId: "critic"
    });

    expect(selected).toMatchObject({ agentId: "story_writer", reason: "selector" });
  });

  test("allows a speaker to return after another participant has spoken", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer")
      .mockResolvedValueOnce("builder");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker, maxTurns: 3 });

    await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });
    const second = await manager.continueTurn({ userMessageId: "msg_1", completedRunId: "run_builder", completedAgentId: "builder" });
    const third = await manager.continueTurn({ userMessageId: "msg_1", completedRunId: "run_reviewer", completedAgentId: "reviewer" });

    expect(second).toMatchObject({ agentId: "reviewer" });
    expect(third).toMatchObject({ agentId: "builder" });
  });

  test("falls back to the previous speaker after selector attempts fail mid-thread", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValue("ghost");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker, maxSelectorAttempts: 2 });

    await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });
    const second = await manager.continueTurn({ userMessageId: "msg_1", completedRunId: "run_builder", completedAgentId: "builder" });

    expect(second).toMatchObject({ agentId: "builder", reason: "fallback", turnIndex: 2 });
  });

  test("new user message in the same room supersedes the previous group turn", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const first = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_old",
      text: "Old topic",
      participants,
      primaryAgentId: "pm"
    });
    const second = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_new",
      text: "New topic",
      participants,
      primaryAgentId: "pm"
    });
    const stale = await manager.continueTurn({
      userMessageId: "msg_old",
      completedRunId: "run_builder",
      completedAgentId: "builder"
    });

    expect(first).toMatchObject({ agentId: "builder" });
    expect(second).toMatchObject({ agentId: "reviewer" });
    expect(stale).toMatchObject({ stopReason: "unknown_turn", userMessageId: "msg_old" });
  });

  test("updates selector history with completed speaker output before choosing the next speaker", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm",
      history: "user: Discuss this"
    });
    await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_builder",
      completedAgentId: "builder",
      history: "user: Discuss this\nBuilder: I recommend a selector-based design."
    });

    expect(selectSpeaker.mock.calls[1]?.[0]).toMatchObject({
      history: expect.stringContaining("Builder: I recommend a selector-based design.")
    });
  });

  test("stops instead of selecting another speaker when the completed speaker produced no visible reply", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });

    const stopped = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_builder",
      completedAgentId: "builder",
      completedText: "   \n"
    });

    expect(stopped).toMatchObject({ stopReason: "no_response", userMessageId: "msg_1" });
    expect(selectSpeaker).toHaveBeenCalledTimes(1);
  });

  test("stops instead of selecting another speaker when the completed speaker only acknowledges", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });

    const stopped = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_builder",
      completedAgentId: "builder",
      completedText: "收到。"
    });

    expect(stopped).toMatchObject({ stopReason: "acknowledgement", userMessageId: "msg_1" });
    expect(selectSpeaker).toHaveBeenCalledTimes(1);
  });

  test("stops when the selector explicitly returns no speaker", async () => {
    const selectSpeaker = vi.fn(async () => "NO_SPEAKER");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker });

    const stopped = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "Discuss this",
      participants,
      primaryAgentId: "pm"
    });

    expect(stopped).toMatchObject({ stopReason: "selector_stop", userMessageId: "msg_1" });
  });

  test("stops after max turns", async () => {
    const selectSpeaker = vi.fn()
      .mockResolvedValueOnce("builder")
      .mockResolvedValueOnce("reviewer");
    const manager = new AssistedSelectorGroupChatManager({ selectSpeaker, maxTurns: 2 });

    const first = await manager.startTurn({
      roomId: "room_1",
      workspaceId: "ws_1",
      userMessageId: "msg_1",
      text: "大家怎么看",
      participants,
      primaryAgentId: "pm"
    });
    expect(first).toMatchObject({ agentId: "builder" });

    const second = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_builder",
      completedAgentId: "builder"
    });
    expect(second).toMatchObject({ agentId: "reviewer" });

    const stopped = await manager.continueTurn({
      userMessageId: "msg_1",
      completedRunId: "run_reviewer",
      completedAgentId: "reviewer"
    });
    expect(stopped).toMatchObject({ stopReason: "max_turns" });
  });
});
