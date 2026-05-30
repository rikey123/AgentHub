import { describe, expect, it } from "vitest";
import { ROOM_MODE_OPTIONS, buildCreateRoomInput } from "./NewRoomDialog.tsx";

describe("NewRoomDialog create-room contract", () => {
  it("offers all V1.0 room modes", () => {
    expect(ROOM_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "solo",
      "assisted",
      "squad",
      "team"
    ]);
  });

  it("builds a team payload with a leader role and role/runtime/model participants", () => {
    const input = buildCreateRoomInput({
      title: "V1.0 team room",
      mode: "team",
      primaryAgentId: "binding_leader",
      leaderRoleId: "role_lead",
      legacyAgentParticipants: [],
      v1Participants: [
        {
          roleId: "role_lead",
          runtimeId: "native-default",
          runtimeKind: "native",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "active"
        },
        {
          roleId: "role_reviewer",
          runtimeId: "custom-acp-1",
          runtimeKind: "custom-acp",
          defaultPresence: "active"
        }
      ]
    });

    expect(input).toEqual({
      title: "V1.0 team room",
      mode: "team",
      primaryAgentId: "binding_leader",
      leaderRoleId: "role_lead",
      participants: [
        {
          roleId: "role_lead",
          runtimeId: "native-default",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "active"
        },
        {
          roleId: "role_reviewer",
          runtimeId: "custom-acp-1",
          defaultPresence: "active"
        }
      ]
    });
  });

  it("rejects native runtime participants without a model config before submit", () => {
    expect(() => buildCreateRoomInput({
      title: "Bad native room",
      mode: "squad",
      primaryAgentId: "mock-builder",
      leaderRoleId: "role_lead",
      legacyAgentParticipants: [],
      v1Participants: [
        {
          roleId: "role_lead",
          runtimeId: "native-default",
          runtimeKind: "native",
          defaultPresence: "active"
        }
      ]
    })).toThrow("Native runtime participants require a model config.");
  });

  it("rejects team rooms where the selected leader role is not included as a participant", () => {
    expect(() => buildCreateRoomInput({
      title: "Bad team room",
      mode: "team",
      primaryAgentId: "binding_reviewer",
      leaderRoleId: "role_lead",
      legacyAgentParticipants: [],
      v1Participants: [
        {
          roleId: "role_reviewer",
          runtimeId: "custom-acp-1",
          runtimeKind: "custom-acp",
          defaultPresence: "active"
        }
      ]
    })).toThrow("Leader role must be included as a participant.");
  });
});
