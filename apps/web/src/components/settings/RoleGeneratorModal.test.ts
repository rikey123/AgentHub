import { describe, expect, it, vi } from "vitest";
import {
  buildGeneratedRoleInput,
  createGeneratedRole,
  deleteRoleGenerationJob,
  normalizeRoleGenerationJob,
  pollRoleGenerationJob,
  startRoleGeneration
} from "./RoleGeneratorModal.tsx";
import { upsertRole, type RoleConfig } from "./RolesTab.tsx";

describe("RoleGeneratorModal REST integration contract", () => {
  it("generates a draft, polls every 500ms, saves a real role, and removes the draft job", async () => {
    vi.useFakeTimers();
    const previousEventSource = globalThis.EventSource;
    const eventSourceSpy = vi.fn();
    Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: eventSourceSpy });

    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === "/roles/generate") {
        expect(init?.credentials).toBe("same-origin");
        return jsonResponse(202, { jobId: "job_abc" });
      }
      if (path === "/roles/generate/jobs/job_abc" && init?.method !== "DELETE") {
        const pollCount = calls.filter((call) => call.path === "/roles/generate/jobs/job_abc" && call.method === undefined).length;
        if (pollCount === 1) return jsonResponse(200, { jobId: "job_abc", status: "running", promptFragment: "Review", tokenCount: 12 });
        return jsonResponse(200, {
          job: {
            id: "job_abc",
            status: "completed",
            prompt_fragment: "Review frontend refactors",
            token_count: 34,
            draftJson: {
              name: "Frontend Refactor Reviewer",
              description: "Reviews frontend refactors",
              prompt: "Review frontend refactors with care.",
              capabilities: ["code.review", "code.edit"],
              suggested_permission_profile_id: "perm_review"
            }
          }
        });
      }
      if (path === "/roles") {
        return jsonResponse(201, {
          role: {
            id: "role_generated",
            name: "Frontend Refactor Reviewer",
            description: "Reviews frontend refactors",
            prompt: "Review frontend refactors with care. Mention migration risk.",
            capabilities: ["code.review", "code.edit"],
            is_builtin: false
          }
        });
      }
      if (path === "/roles/generate/jobs/job_abc" && init?.method === "DELETE") return jsonResponse(204, {});
      return jsonResponse(404, { error: "not_found" });
    });

    const jobId = await startRoleGeneration(fetchImpl, {
      description: "帮我生成一个擅长前端重构的 reviewer",
      modelConfigId: "mc_1"
    });
    const pollPromise = pollRoleGenerationJob(fetchImpl, jobId, { intervalMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    const completed = await pollPromise;
    const roleInput = buildGeneratedRoleInput({
      name: completed.draftJson!.name,
      description: completed.draftJson!.description,
      prompt: `${completed.draftJson!.prompt} Mention migration risk.`,
      capabilitiesText: completed.draftJson!.capabilities.join(", ")
    }, jobId);
    const saved = await createGeneratedRole(fetchImpl, roleInput);
    await deleteRoleGenerationJob(fetchImpl, jobId);
    const nextRoles = upsertRole([role({ id: "role_builder", name: "Builder" })], saved);

    expect(completed).toMatchObject({ status: "completed", tokenCount: 34, draftJson: { name: "Frontend Refactor Reviewer" } });
    expect(saved).toMatchObject({ id: "role_generated", name: "Frontend Refactor Reviewer", is_builtin: false });
    expect(nextRoles.map((item) => item.id)).toEqual(["role_builder", "role_generated"]);
    expect(calls).toEqual([
      { path: "/roles/generate", method: "POST", body: { description: "帮我生成一个擅长前端重构的 reviewer", modelConfigId: "mc_1" } },
      { path: "/roles/generate/jobs/job_abc", method: undefined, body: undefined },
      { path: "/roles/generate/jobs/job_abc", method: undefined, body: undefined },
      { path: "/roles", method: "POST", body: { ...roleInput } },
      { path: "/roles/generate/jobs/job_abc", method: "DELETE", body: undefined }
    ]);
    expect(eventSourceSpy).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: previousEventSource });
    vi.useRealTimers();
  });

  it("cancels a generated draft by deleting the job without creating a role", async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === "/roles/generate") return jsonResponse(202, { jobId: "job_cancel" });
      if (path === "/roles/generate/jobs/job_cancel" && init?.method === "DELETE") return jsonResponse(204, {});
      return jsonResponse(500, { error: "unexpected_call" });
    });

    const jobId = await startRoleGeneration(fetchImpl, { description: "Write a security reviewer", modelConfigId: "mc_1" });
    await deleteRoleGenerationJob(fetchImpl, jobId);

    expect(calls).toEqual([
      { path: "/roles/generate", method: "POST", body: { description: "Write a security reviewer", modelConfigId: "mc_1" } },
      { path: "/roles/generate/jobs/job_cancel", method: "DELETE", body: undefined }
    ]);
    expect(calls.some((call) => call.path === "/roles")).toBe(false);
  });

  it("normalizes failure and expired job states for Try Again / Write Manually UI", () => {
    expect(normalizeRoleGenerationJob("job_fail", { status: "failed", error: "invalid_api_key" })).toEqual({
      jobId: "job_fail",
      status: "failed",
      promptFragment: "",
      tokenCount: 0,
      error: "invalid_api_key"
    });
    expect(normalizeRoleGenerationJob("job_parse", { status: "failed", failureReason: "json_parse_failure" })).toEqual({
      jobId: "job_parse",
      status: "failed",
      promptFragment: "",
      tokenCount: 0,
      error: "json_parse_failure"
    });
    expect(normalizeRoleGenerationJob("job_missing", { status: "expired" })).toMatchObject({ status: "expired" });
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
  return new Response(status === 204 ? null : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
