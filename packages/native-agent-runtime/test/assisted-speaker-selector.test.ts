import { describe, expect, test, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn(() => "language-model"));

vi.mock("ai", () => ({
  generateText: generateTextMock
}));

vi.mock("../src/provider-registry.ts", () => ({
  resolveProvider: resolveProviderMock
}));

import { selectAssistedSpeakerWithModelConfig } from "../src/assisted-speaker-selector.ts";

describe("selectAssistedSpeakerWithModelConfig", () => {
  test("uses an explicit provider and AutoGen-style selector prompt", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "agent_builder" });

    const selected = await selectAssistedSpeakerWithModelConfig({
      modelConfig: { id: "model_1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: "key_1" },
      apiKey: "secret",
      request: {
        roomId: "room_1",
        workspaceId: "ws_1",
        userMessageId: "msg_1",
        text: "Discuss this",
        previousSpeakerId: "agent_pm",
        attempt: 2,
        feedback: "No valid name was mentioned. Please select from: ['agent_builder', 'agent_reviewer'].",
        history: "user: Discuss this\nagent_pm: I will ask Builder.",
        participants: [
          { agentId: "agent_builder", name: "Builder", role: "teammate", description: "Builds implementation plans." },
          { agentId: "agent_reviewer", name: "Reviewer", role: "teammate", description: "Reviews risks." }
        ]
      }
    });

    expect(selected).toBe("agent_builder");
    expect(resolveProviderMock).toHaveBeenCalledWith(expect.objectContaining({ id: "model_1", provider: "openai", model: "gpt-4o" }), "secret");
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "language-model",
      prompt: expect.stringContaining("Roles:")
    }));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Conversation:"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Candidates:"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("agent_builder"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Selector feedback from previous attempt:"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("No valid name was mentioned."));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Attempt: 2"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("First inspect the shared conversation history."));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Use the shared history like AutoGen's group chat message thread."));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Prefer a candidate who can respond to a concrete prior point"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Do not stop merely because the latest assistant message partially answers the user."));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("latest turns are repeating the same stance"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("clear conclusion or recommendation"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Return NO_SPEAKER if the conversation has an explicit closing synthesis"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.not.stringContaining("If the latest assistant message already gives a final synthesis, answers the user"));
    expect(generateTextMock.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining("Return only the candidate id, candidate name, or NO_SPEAKER."));
  });
});
