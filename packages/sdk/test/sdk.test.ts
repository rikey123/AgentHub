import { describe, expect, it } from "vitest";

import { AgentHubClient } from "../src/index.ts";

describe("AgentHubClient", () => {
  it("calls JSON daemon APIs", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch
    });
    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["http://daemon/healthz"]);
  });

  it("builds permission API requests", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    });
    await client.listPermissionRequests({ status: "pending", roomId: "room_1" });
    await client.resolvePermission("preq_1", { decision: "allow", remember: true });
    expect(calls).toEqual(["http://daemon/permissions/requests?status=pending&roomId=room_1", "http://daemon/permissions/preq_1/resolve"]);
  });

  it("does not publish an SDK helper for internal-only context injection", () => {
    const client = new AgentHubClient({ baseUrl: "http://daemon" });

    expect("injectContext" in client).toBe(false);
  });

  it("sends V1.0 team room creation fields without dropping role bindings", async () => {
    const calls: Array<{ readonly url: string; readonly body: unknown }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
        });
        return new Response(JSON.stringify({ data: { roomId: "room_team" } }), { status: 201 });
      }) as typeof fetch
    });

    await client.createRoom({
      title: "Team room",
      mode: "team",
      primaryAgentId: "binding_leader",
      leaderRoleId: "role_leader",
      participants: [
        { roleId: "role_leader", runtimeId: "native-default", modelConfigId: "mc_1", defaultPresence: "active" },
        { roleId: "role_reviewer", runtimeId: "claude-code-default", defaultPresence: "active" }
      ]
    });

    expect(calls).toEqual([{
      url: "http://daemon/rooms",
      body: {
        title: "Team room",
        mode: "team",
        primaryAgentId: "binding_leader",
        leaderRoleId: "role_leader",
        participants: [
          { roleId: "role_leader", runtimeId: "native-default", modelConfigId: "mc_1", defaultPresence: "active" },
          { roleId: "role_reviewer", runtimeId: "claude-code-default", defaultPresence: "active" }
        ]
      }
    }]);
  });

  it("builds intervention and debug API requests", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    });

    await client.listInterventions({ roomId: "room_1", status: "pending_user_decision" });
    await client.approveIntervention("int_1", { effectiveText: "edited" });
    await client.debugEvents({ traceId: "trace_1", limit: "10" });
    await client.debugStats();

    expect(calls).toEqual(["http://daemon/interventions?roomId=room_1&status=pending_user_decision", "http://daemon/interventions/int_1/approve", "http://daemon/debug/events?traceId=trace_1&limit=10", "http://daemon/debug/stats"]);
  });

  it("builds the assisted discussion stop request", async () => {
    const calls: Array<{ readonly url: string; readonly method?: string }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), ...(init?.method !== undefined ? { method: init.method } : {}) });
        return new Response(JSON.stringify({ ok: true, cancelledRunIds: ["run-1"] }), { status: 200 });
      }) as typeof fetch
    });

    await client.stopDiscussion("room_1");

    expect(calls).toEqual([{ url: "http://daemon/rooms/room_1/discussion/stop", method: "POST" }]);
  });
});
