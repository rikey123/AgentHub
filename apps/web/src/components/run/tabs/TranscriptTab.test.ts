import { describe, expect, it } from "vitest";
import type { RoomViewModel } from "../../../types.ts";
import { getTranscriptEmptyState } from "./TranscriptTab.tsx";

describe("TranscriptTab empty state", () => {
  it("shows the run failure reason when no transcript was created", () => {
    const state = getTranscriptEmptyState(roomFixture({
      runs: [
        {
          id: "run-failed",
          agentId: "agent-pm",
          agentName: "Project Manager",
          status: "failed",
          failureClass: "configuration",
          error: "No available channel for model gpt-5.4-mini"
        }
      ]
    }), "run-failed");

    expect(state).toEqual({
      title: "Run failed before a transcript was created.",
      description: "No available channel for model gpt-5.4-mini",
      tone: "danger"
    });
  });
});

function roomFixture(patch: Partial<RoomViewModel>): RoomViewModel {
  return {
    id: "room-1",
    title: "Room",
    mode: "team",
    primaryAgentId: undefined,
    participants: [],
    participantContactNames: {},
    messages: [],
    briefs: [],
    unresolvedInterventions: [],
    pendingPermissions: [],
    contextItems: [],
    tasks: [],
    runs: [],
    pendingTurns: [],
    mailboxFailures: [],
    artifactVersionsById: {},
    deploymentsById: {},
    deploymentLogsById: {},
    unreadCount: 0,
    ...patch
  };
}
