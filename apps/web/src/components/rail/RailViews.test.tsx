import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArtifactsRailView,
  ContactsRailView,
  RunsRailView,
  TasksRailView,
  artifactFilePreviewRequestForLibrary,
  createNewAgentContact,
  normalizeArtifactLibrary,
  normalizeAgentContacts,
  normalizeRuntimeOptions,
  readArtifactFilePreviewContent,
  runtimeHealthBadgeForContact,
  testContactRuntimeConnection
} from "./RailViews.tsx";

describe("rail views", () => {
  it("normalizes contacts from the daemon contact directory shape", () => {
    expect(normalizeAgentContacts({
      contacts: [{
        agentBindingId: "mock-builder",
        displayName: "Mock Builder",
        roleId: "role_mock",
        runtimeId: "mock-runtime",
        runtimeName: "Mock Runtime",
        runtimeKind: "mock",
        capabilities: ["chat"],
        status: "available"
      }, {
        agentBindingId: "binding_builder",
        displayName: "Frontend Builder",
        roleId: "role_builder",
        runtimeId: "runtime_opencode",
        modelConfigId: "mc_fast",
        roleName: "UI Builder",
        runtimeName: "OpenCode",
        runtimeKind: "opencode",
        modelName: "gpt-5",
        avatarUrl: "https://example.test/avatar.png",
        capabilities: ["code.edit", "artifact.publish"],
        skills: ["web-page-builder"],
        status: "available",
        description: "Builds UI artifacts"
      }]
    })).toEqual([{
      agentBindingId: "binding_builder",
      displayName: "Frontend Builder",
      roleId: "role_builder",
      runtimeId: "runtime_opencode",
      modelConfigId: "mc_fast",
      roleName: "UI Builder",
      runtimeName: "OpenCode",
      runtimeKind: "opencode",
      modelName: "gpt-5",
      avatarUrl: "https://example.test/avatar.png",
      capabilities: ["code.edit", "artifact.publish"],
      skills: ["web-page-builder"],
      status: "available",
      description: "Builds UI artifacts"
    }]);
  });

  it("renders a contacts directory surface with identity tags and start edit configure actions", () => {
    const html = renderToStaticMarkup(createElement(ContactsRailView, {
      contacts: [{
        agentBindingId: "binding_builder",
        displayName: "Frontend Builder",
        roleId: "role_builder",
        runtimeId: "runtime_opencode",
        modelConfigId: "mc_fast",
        roleName: "UI Builder",
        runtimeName: "OpenCode",
        runtimeKind: "opencode",
        modelName: "gpt-5",
        avatarUrl: "https://example.test/avatar.png",
        capabilities: ["code.edit", "artifact.publish", "web.search", "terminal.run"],
        skills: ["web-page-builder"],
        status: "available",
        description: "Builds UI artifacts",
        systemPrompt: "Build useful interfaces."
      }],
      loading: false,
      onStartChat: () => undefined,
      onCreateAgent: () => undefined,
      onEditContact: () => undefined,
      onConfigureContact: () => undefined,
      onTestConnection: () => undefined
    }));

    expect(html).toContain("Agent 联系人");
    expect(html).toContain("Frontend Builder");
    expect(html).toContain("UI Builder");
    expect(html).toContain("OpenCode");
    expect(html).toContain("gpt-5");
    expect(html).toContain("在线");
    expect(html).toContain("代码编辑");
    expect(html).not.toContain("code.edit");
    expect(html).toContain("+1 更多");
    expect(html).toContain("Build useful interfaces.");
    expect(html).toContain("开始聊天");
    expect(html).toContain("新建 Agent");
    expect(html).toContain("编辑 / 配置");
    expect(html).toContain("测试连接");
    expect(html).toContain("runtime_opencode");
  });

  it("normalizes runtime options for the new agent editor", () => {
    expect(normalizeRuntimeOptions([
      {
        id: "mock-runtime",
        kind: "mock",
        name: "Mock Runtime"
      },
      {
        id: "runtime_claude",
        kind: "claude-code",
        name: "Claude Code",
        detected_version: "2.1.168",
        status: "available"
      },
      {
        id: "runtime_codex",
        kind: "codex",
        name: "Codex",
        version: "0.134.0",
        status: "ready"
      }
    ])).toEqual([
      {
        id: "runtime_claude",
        kind: "claude-code",
        name: "Claude Code",
        version: "2.1.168",
        status: "available"
      },
      {
        id: "runtime_codex",
        kind: "codex",
        name: "Codex",
        version: "0.134.0",
        status: "ready"
      }
    ]);
  });

  it("creates a custom agent then refreshes the contacts directory", async () => {
    const calls: Array<{ readonly path: string; readonly method: string | undefined; readonly body?: unknown }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        path: String(input),
        method: init?.method,
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {})
      });
      if (String(input) === "/agents/custom") {
        return jsonResponse(201, { agentBindingId: "binding_new_agent", roleId: "role_new_agent" });
      }
      if (String(input) === "/agents/contacts") {
        return jsonResponse(200, {
          contacts: [{
            agentBindingId: "binding_new_agent",
            displayName: "Launch Builder",
            roleId: "role_new_agent",
            runtimeId: "runtime_claude",
            runtimeKind: "claude-code",
            runtimeName: "Claude Code",
            capabilities: ["chat"],
            status: "available",
            description: "Build launch pages"
          }]
        });
      }
      return jsonResponse(404, { error: "not_found" });
    };

    await expect(createNewAgentContact(fetchImpl as typeof fetch, {
      name: "Launch Builder",
      runtimeId: "runtime_claude",
      runtimeKind: "claude-code",
      runtimeName: "Claude Code",
      description: "Build launch pages",
      systemPrompt: "Build crisp web pages."
    })).resolves.toMatchObject({
      agentBindingId: "binding_new_agent",
      displayName: "Launch Builder",
      runtimeId: "runtime_claude",
      runtimeKind: "claude-code",
      status: "available"
    });

    expect(calls).toEqual([
      {
        path: "/agents/custom",
        method: "POST",
        body: {
          name: "Launch Builder",
          runtimeId: "runtime_claude",
          description: "Build launch pages",
          systemPrompt: "Build crisp web pages.",
          capabilities: ["chat"]
        }
      },
      { path: "/agents/contacts", method: undefined }
    ]);
  });

  it("posts contact runtime health checks and maps green red experimental states", async () => {
    const calls: Array<{ readonly path: string; readonly method: string | undefined }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), method: init?.method });
      if (String(input) === "/runtimes/runtime_opencode/health") return jsonResponse(200, { ok: true, version: "OpenCode 1.2.3" });
      if (String(input) === "/runtimes/runtime_missing/health") return jsonResponse(503, { ok: false, error: "Connection refused" });
      if (String(input) === "/runtimes/runtime_codex/health") return jsonResponse(200, { ok: true, experimental: true, version: "Codex 0.7.0" });
      return jsonResponse(404, { error: "not_found" });
    };

    await expect(testContactRuntimeConnection(fetchImpl as typeof fetch, "runtime_opencode", "opencode")).resolves.toEqual({
      status: "success",
      version: "OpenCode 1.2.3"
    });
    await expect(testContactRuntimeConnection(fetchImpl as typeof fetch, "runtime_missing", "opencode")).resolves.toEqual({
      status: "error",
      error: "Connection refused"
    });
    await expect(testContactRuntimeConnection(fetchImpl as typeof fetch, "runtime_codex", "codex")).resolves.toEqual({
      status: "experimental",
      version: "Codex 0.7.0"
    });

    expect(calls).toEqual([
      { path: "/runtimes/runtime_opencode/health", method: "POST" },
      { path: "/runtimes/runtime_missing/health", method: "POST" },
      { path: "/runtimes/runtime_codex/health", method: "POST" }
    ]);
  });

  it("derives experimental runtime badges for Codex contacts before health checks", () => {
    expect(runtimeHealthBadgeForContact({
      agentBindingId: "binding_codex",
      displayName: "Codex Draft",
      roleId: "role_codex",
      runtimeId: "runtime_codex",
      runtimeKind: "codex",
      runtimeName: "Codex",
      capabilities: [],
      status: "available"
    })).toEqual({ status: "experimental" });
  });

  it("normalizes artifact library rows from GET /artifacts", () => {
    expect(normalizeArtifactLibrary({
      artifacts: [{
        id: "artifact_home",
        kind: "web_page",
        title: "Landing page",
        filename: "index.html",
        latestVersion: 3,
        roomId: "room_1",
        createdBy: "Builder",
        mimeType: "text/html",
        sizeBytes: 4096,
        updatedAt: 12345,
        filePath: "index.html"
      }]
    })).toEqual([{
      id: "artifact_home",
      kind: "web_page",
      title: "Landing page",
      filename: "index.html",
      latestVersion: 3,
      roomId: "room_1",
      createdBy: "Builder",
      mimeType: "text/html",
      sizeBytes: 4096,
      updatedAt: 12345,
      filePath: "index.html"
    }]);
  });

  it("builds artifact preview requests for library rows", () => {
    expect(artifactFilePreviewRequestForLibrary({
      id: "artifact home",
      kind: "web_page",
      title: "Landing page",
      filename: "index.html",
      filePath: "src/index.html"
    })).toEqual({
      contentPath: "/artifacts/artifact%20home/files/src%2Findex.html",
      rawUrl: "/artifacts/artifact%20home/files/src%2Findex.html/raw",
      name: "src/index.html"
    });
  });

  it("extracts markdown content from artifact file preview JSON envelopes", async () => {
    const markdown = "# 多 Agent 协作方案讨论总结\n\n正文内容";
    const response = jsonResponse(200, {
      content: {
        file: {
          artifactId: "artifact_summary",
          path: "multi-agent-collaboration-summary.md",
          newContent: markdown
        },
        content: markdown
      }
    });

    await expect(readArtifactFilePreviewContent(response)).resolves.toBe(markdown);
  });

  it("renders an artifact library surface with version and file metadata", () => {
    const html = renderToStaticMarkup(createElement(ArtifactsRailView, {
      artifacts: [{
        id: "artifact_home",
        kind: "web_page",
        title: "Landing page",
        filename: "index.html",
        filePath: "index.html",
        latestVersion: 3,
        roomId: "room_1",
        createdBy: "Builder",
        mimeType: "text/html",
        sizeBytes: 4096,
        updatedAt: 12345
      }],
      loading: false
    }));

    expect(html).toContain("产物库");
    expect(html).toContain("Landing page");
    expect(html).toContain("web_page");
    expect(html).toContain("index.html");
    expect(html).toContain("v3");
    expect(html).toContain("4 KB");
    expect(html).toContain("打开预览");
    expect(html).toContain("data-artifact-id=\"artifact_home\"");
  });

  it("renders artifact library search and kind filter controls", () => {
    const html = renderToStaticMarkup(createElement(ArtifactsRailView, {
      artifacts: [{
        id: "artifact_home",
        kind: "web_page",
        title: "Landing page",
        filename: "index.html",
        latestVersion: 3,
        roomId: "room_1",
        createdBy: "Builder",
        mimeType: "text/html",
        sizeBytes: 4096,
        updatedAt: 12345
      }],
      loading: false
    }));

    expect(html).toContain("搜索产物");
    expect(html).toContain("类型筛选");
    expect(html).toContain("最近产物");
  });

  it("renders primary rail views for runs and tasks", () => {
    const runs = renderToStaticMarkup(createElement(RunsRailView));
    const tasks = renderToStaticMarkup(createElement(TasksRailView));

    expect(runs).toContain("运行");
    expect(runs).toContain("运行活动");
    expect(tasks).toContain("任务");
    expect(tasks).toContain("任务工作台");
  });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
