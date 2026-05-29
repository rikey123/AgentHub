import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_ROLE_WARNING,
  createRole,
  deleteRole,
  normalizeRoles,
  updateRole,
  upsertRole,
  type RoleConfig
} from "./RolesTab.tsx";

describe("RolesTab REST integration contract", () => {
  it("creates a role through POST /roles and updates local state from the response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/roles");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("same-origin");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Release Reviewer",
        description: "Checks release risk",
        prompt: "Review the release plan.",
        capabilities: ["code.review", "task.delegate"]
      });
      return jsonResponse(201, {
        id: "role_release_reviewer",
        name: "Release Reviewer",
        description: "Checks release risk",
        prompt: "Review the release plan.",
        capabilities: ["code.review", "task.delegate"],
        is_builtin: 0
      });
    });

    const created = await createRole(fetchImpl, {
      name: "Release Reviewer",
      description: "Checks release risk",
      prompt: "Review the release plan.",
      capabilities: ["code.review", "task.delegate"]
    });
    const nextRoles = upsertRole([role({ id: "role_builder", name: "Builder" })], created);

    expect(created).toEqual({
      id: "role_release_reviewer",
      name: "Release Reviewer",
      description: "Checks release risk",
      prompt: "Review the release plan.",
      capabilities: ["code.review", "task.delegate"],
      is_builtin: false
    });
    expect(nextRoles.map((item) => item.name)).toEqual(["Builder", "Release Reviewer"]);
  });

  it("edits a builtin role prompt through PATCH /roles/:id and exposes the builtin warning", async () => {
    const [builtin] = normalizeRoles([
      {
        id: "role_generalist",
        name: "Generalist",
        description: "Built in fallback",
        prompt: "Handle general tasks.",
        capabilities: '["chat"]',
        is_builtin: 1
      }
    ]);
    expect(builtin).toMatchObject({ is_builtin: true, capabilities: ["chat"] });
    expect(BUILTIN_ROLE_WARNING.replace("<id>", builtin!.id)).toContain("agenthub roles reset --id=role_generalist");

    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/roles/role_generalist");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Generalist",
        description: "Built in fallback",
        prompt: "Handle general tasks with extra care.",
        capabilities: ["chat"]
      });
      return jsonResponse(200, {
        id: "role_generalist",
        name: "Generalist",
        description: "Built in fallback",
        prompt: "Handle general tasks with extra care.",
        capabilities: ["chat"],
        is_builtin: true
      });
    });

    const updated = await updateRole(fetchImpl, "role_generalist", {
      name: "Generalist",
      description: "Built in fallback",
      prompt: "Handle general tasks with extra care.",
      capabilities: ["chat"]
    });

    expect(updated).toMatchObject({ id: "role_generalist", prompt: "Handle general tasks with extra care.", is_builtin: true });
  });

  it("keeps a bound role in local state and surfaces the 409 delete message", async () => {
    const roles = [role({ id: "role_bound", name: "Bound Role" })];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/roles/role_bound");
      expect(init?.method).toBe("DELETE");
      return jsonResponse(409, { error: "role_has_bindings", bindingCount: 2 });
    });

    await expect(deleteRole(fetchImpl, "role_bound")).rejects.toThrow("Role has 2 agent bindings; remove bindings before deleting.");
    expect(roles).toEqual([expect.objectContaining({ id: "role_bound", name: "Bound Role" })]);
  });
});

function role(patch: Partial<RoleConfig>): RoleConfig {
  return {
    id: "role",
    name: "Role",
    description: "",
    prompt: "",
    capabilities: [],
    is_builtin: false,
    ...patch
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
