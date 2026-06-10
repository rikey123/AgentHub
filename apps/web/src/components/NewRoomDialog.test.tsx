import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContactFirstPicker,
  ROOM_MODE_OPTIONS,
  RoleBindingRow,
  RoleSelect,
  buildContactFirstCreateRoomInput,
  buildCreateRoomInput,
  defaultRoomModeForSelectedContacts,
  ensureAgentBindingsForParticipants
} from "./NewRoomDialog.tsx";

describe("NewRoomDialog create-room contract", () => {
  it("offers product-ready room modes", () => {
    expect(ROOM_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "solo",
      "assisted",
      "team"
    ]);
  });

  it("defaults contact-first room mode from selected contact count", () => {
    expect(defaultRoomModeForSelectedContacts(0, "team")).toBe("team");
    expect(defaultRoomModeForSelectedContacts(1, "assisted")).toBe("solo");
    expect(defaultRoomModeForSelectedContacts(2, "solo")).toBe("assisted");
  });

  it("renders a contact-first picker before advanced participant configuration", () => {
    const html = renderToStaticMarkup(createElement(ContactFirstPicker, {
      contacts: [
        {
          agentBindingId: "binding_builder",
          displayName: "Frontend Builder",
          roleId: "role_builder",
          runtimeKind: "opencode",
          capabilities: ["code.edit", "file.write"],
          status: "available"
        },
        {
          agentBindingId: "binding_reviewer",
          displayName: "Reviewer",
          roleId: "role_reviewer",
          runtimeKind: "claude-code",
          capabilities: ["code.review"],
          status: "busy"
        }
      ],
      selectedIds: new Set(["binding_builder"]),
      loading: false,
      onToggle: () => undefined
    }));

    expect(html).toContain("联系人");
    expect(html).toContain("Frontend Builder");
    expect(html).toContain("OpenCode");
    expect(html).toContain("构建者");
    expect(html).toContain("代码编辑");
    expect(html).not.toContain("code.edit");
    expect(html).toContain("已选择 1 个");
    expect(html).toContain("Reviewer");
  });

  it("builds a contact-first create-room payload from selected contacts", () => {
    const input = buildContactFirstCreateRoomInput({
      title: "Ship UI",
      mode: "solo",
      skillIds: ["skill_task_planner"],
      contacts: [
        {
          agentBindingId: "binding_builder",
          displayName: "Frontend Builder",
          roleId: "role_builder",
          runtimeKind: "opencode",
          capabilities: ["code.edit"],
          status: "available"
        },
        {
          agentBindingId: "binding_reviewer",
          displayName: "Reviewer",
          roleId: "role_reviewer",
          runtimeKind: "claude-code",
          capabilities: ["code.review"],
          status: "busy"
        }
      ]
    });

    expect(input).toEqual({
      title: "Ship UI",
      mode: "assisted",
      primaryAgentId: "binding_builder",
      agentBindingId: "binding_builder",
      skillIds: ["skill_task_planner"],
      participants: [
        {
          type: "agent",
          agentId: "binding_reviewer",
          agentBindingId: "binding_reviewer",
          role: "teammate",
          defaultPresence: "active"
        }
      ]
    });
  });

  it("preserves Team mode for contact-first rooms and supplies a leader role", () => {
    const input = buildContactFirstCreateRoomInput({
      title: "Team launch",
      mode: "team",
      contacts: [
        {
          agentBindingId: "binding_lead",
          displayName: "Team Lead",
          roleId: "role_pm",
          runtimeKind: "native",
          capabilities: ["task.delegate"],
          status: "available"
        },
        {
          agentBindingId: "binding_builder",
          displayName: "Builder",
          roleId: "role_builder",
          runtimeKind: "opencode",
          capabilities: ["code.edit"],
          status: "available"
        }
      ]
    });

    expect(input).toEqual({
      title: "Team launch",
      mode: "team",
      primaryAgentId: "binding_lead",
      agentBindingId: "binding_lead",
      leaderRoleId: "role_pm",
      participants: [
        {
          type: "agent",
          agentId: "binding_builder",
          agentBindingId: "binding_builder",
          role: "teammate",
          defaultPresence: "active"
        }
      ]
    });
  });

  it("builds contact-first participant overrides and per-contact skill assignments", () => {
    const input = buildContactFirstCreateRoomInput({
      title: "Configured contact room",
      mode: "team",
      skillIds: ["skill_room"],
      contacts: [
        {
          agentBindingId: "binding_lead",
          displayName: "Team Lead",
          roleId: "role_pm",
          runtimeKind: "opencode",
          capabilities: ["task.delegate"],
          status: "available"
        },
        {
          agentBindingId: "binding_builder",
          displayName: "Builder",
          roleId: "role_builder",
          runtimeKind: "opencode",
          capabilities: ["code.edit"],
          status: "available"
        }
      ],
      participantConfigs: [
        {
          agentBindingId: "binding_lead",
          defaultPresence: "observing",
          skillIds: ["skill_plan"]
        },
        {
          agentBindingId: "binding_builder",
          roleId: "role_reviewer",
          runtimeId: "native-default",
          runtimeKind: "native",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "observing",
          skillIds: ["skill_review"]
        }
      ],
      resolvedBindingIds: {
        binding_builder: "binding_reviewer_native"
      }
    } as Parameters<typeof buildContactFirstCreateRoomInput>[0]);

    expect(input).toEqual({
      title: "Configured contact room",
      mode: "team",
      primaryAgentId: "binding_lead",
      agentBindingId: "binding_lead",
      leaderRoleId: "role_pm",
      skillIds: ["skill_room"],
      participants: [
        {
          type: "agent",
          agentId: "binding_lead",
          agentBindingId: "binding_lead",
          role: "primary",
          defaultPresence: "observing"
        },
        {
          type: "agent",
          agentId: "binding_reviewer_native",
          agentBindingId: "binding_reviewer_native",
          role: "teammate",
          defaultPresence: "observing"
        }
      ],
      participantSkillAssignments: [
        {
          participantId: "binding_lead",
          skillIds: ["skill_plan"],
          mode: "add"
        },
        {
          participantId: "binding_reviewer_native",
          skillIds: ["skill_review"],
          mode: "add"
        }
      ]
    });
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
      skillIds: ["skill_task_planner", "skill_review_guide"],
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
      skillIds: ["skill_task_planner", "skill_review_guide"],
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

  it("builds a solo payload from one role/runtime/model participant", () => {
    const input = buildCreateRoomInput({
      title: "Native solo",
      mode: "solo",
      primaryAgentId: "binding_pm",
      legacyAgentParticipants: [
        { type: "agent", agentId: "mock-builder", role: "observer", defaultPresence: "observing" }
      ],
      v1Participants: [
        {
          roleId: "role_pm",
          runtimeId: "native-default",
          runtimeKind: "native",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "active"
        }
      ]
    });

    expect(input).toEqual({
      title: "Native solo",
      mode: "solo",
      primaryAgentId: "binding_pm",
      participants: [
        {
          roleId: "role_pm",
          runtimeId: "native-default",
          modelConfigId: "mc_gpt4o",
          role: "primary",
          defaultPresence: "active"
        }
      ]
    });
  });

  it("builds an assisted payload from role/runtime/model participants instead of legacy agents", () => {
    const input = buildCreateRoomInput({
      title: "Assisted room",
      mode: "assisted",
      primaryAgentId: "binding_pm",
      legacyAgentParticipants: [
        { type: "agent", agentId: "mock-reviewer", role: "reviewer", defaultPresence: "active" }
      ],
      v1Participants: [
        {
          roleId: "role_pm",
          runtimeId: "native-default",
          runtimeKind: "native",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "active"
        },
        {
          roleId: "role_builder",
          runtimeId: "runtime-opencode",
          runtimeKind: "opencode",
          defaultPresence: "active"
        }
      ]
    });

    expect(input).toEqual({
      title: "Assisted room",
      mode: "assisted",
      primaryAgentId: "binding_pm",
      participants: [
        {
          roleId: "role_pm",
          runtimeId: "native-default",
          modelConfigId: "mc_gpt4o",
          role: "primary",
          defaultPresence: "active"
        },
        {
          roleId: "role_builder",
          runtimeId: "runtime-opencode",
          role: "teammate",
          defaultPresence: "active"
        }
      ]
    });
  });

  it("rejects native runtime participants without a model config before submit", () => {
    expect(() => buildCreateRoomInput({
      title: "Bad native room",
      mode: "team",
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

  it("does not reuse disabled existing bindings when preparing room participants", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetchImpl = (async (input, init) => {
      requests.push({ path: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({
        agentBinding: {
          id: "binding_active_lead",
          roleId: "role_lead",
          runtimeId: "native-default",
          modelConfigId: "mc_gpt4o"
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const result = await ensureAgentBindingsForParticipants({
      fetchImpl,
      existingBindings: [{
        id: "binding_disabled_lead",
        roleId: "role_lead",
        runtimeId: "native-default",
        modelConfigId: "mc_gpt4o",
        disabledAt: 1234
      }],
      participants: [
        {
          roleId: "role_lead",
          runtimeId: "native-default",
          runtimeKind: "native",
          modelConfigId: "mc_gpt4o",
          defaultPresence: "active"
        }
      ]
    });

    expect(result.bindingIds).toEqual(["binding_active_lead"]);
    expect(requests).toEqual([
      {
        path: "/agent-bindings",
        body: { roleId: "role_lead", runtimeId: "native-default", modelConfigId: "mc_gpt4o" }
      }
    ]);
  });
});
