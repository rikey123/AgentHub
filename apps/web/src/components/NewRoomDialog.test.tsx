import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ROOM_MODE_OPTIONS,
  RoleBindingRow,
  RoleSelect,
  buildCreateRoomInput,
  ensureAgentBindingsForParticipants
} from "./NewRoomDialog.tsx";

describe("NewRoomDialog create-room contract", () => {
  it("offers all V1.0 room modes", () => {
    expect(ROOM_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "solo",
      "assisted",
      "squad",
      "team"
    ]);
  });

  it("renders V1 role selection with HeroUI Select instead of a native select", () => {
    const html = renderToStaticMarkup(createElement(RoleSelect, {
      label: "Leader Role",
      value: "role_lead",
      roles: [
        { id: "role_lead", name: "Lead", description: "Coordinates work", prompt: "", capabilities: ["task.delegate"], is_builtin: true },
        { id: "role_review", name: "Reviewer", description: "Reviews work", prompt: "", capabilities: ["code.review"], is_builtin: true }
      ],
      onChange: () => undefined,
      testId: "new-room-leader-role"
    }));

    expect(html).toContain("Leader Role");
    expect(html).toContain("select__trigger");
    expect(html).toContain("hidden-select-container");
  });

  it("renders a leader binding row with explicit role, runtime, and model selectors", () => {
    const html = renderToStaticMarkup(createElement(RoleBindingRow, {
      title: "Leader binding",
      roleId: "role_lead",
      runtimeId: "native-default",
      modelConfigId: "mc_gpt4o",
      presence: "active",
      roles: [
        { id: "role_lead", name: "Lead", description: "Coordinates work", prompt: "", capabilities: ["task.delegate"], is_builtin: true }
      ],
      runtimes: [
        { id: "native-default", name: "AgentHub Native", kind: "native", detectedVersion: "native", version: null }
      ],
      modelConfigs: [
        { id: "mc_gpt4o", name: "GPT-4o", provider: "openai", model: "gpt-4o" }
      ],
      onChange: () => undefined,
      testIdPrefix: "new-room-leader"
    }));

    expect(html).toContain("Leader binding");
    expect(html).toContain("new-room-leader-role");
    expect(html).toContain("new-room-leader-runtime");
    expect(html).toContain("new-room-leader-model");
    expect(html).toContain("AgentHub Native");
    expect(html).toContain("GPT-4o");
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

  it("creates missing agent bindings before submitting a V1 team room", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetchImpl = (async (input, init) => {
      requests.push({ path: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      const request = requests[requests.length - 1]!;
      const body = request.body as { readonly roleId?: string };
      return new Response(JSON.stringify({
        agentBinding: {
          id: body.roleId === "role_lead" ? "binding_created_lead" : "binding_created_reviewer",
          roleId: body.roleId,
          runtimeId: (body as { readonly runtimeId?: string }).runtimeId,
          modelConfigId: (body as { readonly modelConfigId?: string }).modelConfigId ?? null
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const result = await ensureAgentBindingsForParticipants({
      fetchImpl,
      existingBindings: [],
      participants: [
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

    expect(result.bindingIds).toEqual(["binding_created_lead", "binding_created_reviewer"]);
    expect(requests).toEqual([
      {
        path: "/agent-bindings",
        body: { roleId: "role_lead", runtimeId: "native-default", modelConfigId: "mc_gpt4o" }
      },
      {
        path: "/agent-bindings",
        body: { roleId: "role_reviewer", runtimeId: "custom-acp-1" }
      }
    ]);
  });
});
