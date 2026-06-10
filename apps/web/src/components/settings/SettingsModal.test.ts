import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeatureRail } from "../shell/FeatureRail.tsx";
import {
  McpPlaceholder,
  PermissionsSettingsTab,
  ROOM_MCP_TOOLS,
  SETTINGS_TABS,
  SettingsPanel,
  WorkspaceTab,
  DeployProvidersSettingsTab,
  clearDeploymentProviderTestResultsForChangedProviders,
  createDeploymentProvider,
  deleteDeploymentProvider,
  fetchSettingsBootstrap,
  shouldApplyDeploymentProviderTestResult,
  normalizeDeploymentProviders,
  testDeploymentProvider,
  updateDeploymentProviderTestResults,
  updateDeploymentProvider,
  updateDefaultPermissionProfile
} from "./SettingsModal.tsx";
import {
  SkillsTab,
  createSkill,
  fetchRuntimeLocalSkills,
  fetchSkillDetail,
  importRuntimeLocalSkill,
  normalizeRuntimeLocalSkillList,
  normalizeSkills,
  updateSkill
} from "./SkillsTab.tsx";

describe("SettingsModal integration contract", () => {
  it("defines the V1.2 top-level tabs with deploy providers included", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "角色",
      "运行时",
      "模型",
      "技能",
      "许可",
      "工作区",
      "部署提供方",
      "MCP"
    ]);
    expect(SETTINGS_TABS[0]?.id).toBe("roles");
    expect(SETTINGS_TABS.find((tab) => tab.id === "deploy-providers")?.endpoint).toBe(
      "deploymentProviders"
    );
  });

  it("opens settings from the FeatureRail Settings entry point", () => {
    const onOpenSettings = vi.fn();
    const onSelect = vi.fn();
    const tree = FeatureRail({ active: "chat", onSelect, onOpenSettings });
    const settingsButton = findElementByProp(tree, "aria-label", "Settings");

    expect(settingsButton).toBeDefined();
    const onClick = settingsButton?.props.onClick;
    expect(typeof onClick).toBe("function");
    if (typeof onClick === "function") onClick();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalledWith("settings");
  });

  it("labels the product rail as V1.2", () => {
    const html = renderToStaticMarkup(
      createElement(FeatureRail, {
        active: "chat",
        onSelect: vi.fn(),
        onOpenSettings: vi.fn()
      })
    );

    expect(html).toContain("v1.2");
    expect(html).not.toContain("v1.0");
    expect(html).not.toContain("v0.5");
  });

  it("exposes contacts rail entry once the contacts view exists", () => {
    const onSelect = vi.fn();
    const tree = FeatureRail({ active: "chat", onSelect, onOpenSettings: vi.fn() });
    const contactsButton = findElementByProp(tree, "aria-label", "Contacts");

    expect(contactsButton).toBeDefined();
    const onClick = contactsButton?.props.onClick;
    expect(typeof onClick).toBe("function");
    if (typeof onClick === "function") onClick();

    expect(onSelect).toHaveBeenCalledWith("contacts");
  });

  it("bootstraps settings with eight parallel REST requests including deploy providers, then workspace metadata, and no EventSource", async () => {
    const previousEventSource = globalThis.EventSource;
    const eventSourceSpy = vi.fn();
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: eventSourceSpy
    });

    try {
      const calls: Array<{ path: string; signal: AbortSignal | undefined }> = [];
      const pendingResolvers: Array<() => void> = [];
      const fetchImpl = vi.fn<typeof fetch>((input, init) => {
        calls.push({ path: String(input), signal: init?.signal ?? undefined });
        return new Promise<Response>((resolve) => {
          pendingResolvers.push(() => {
            const path = String(input);
            const body =
              path === "/agent-bindings"
                ? {
                    agentBindings: [
                      {
                        id: "binding_1",
                        workspaceId: "ws_1",
                        role: { name: "Reviewer" },
                        runtime: { kind: "native", name: "Native", detectedVersion: "native" },
                        modelConfig: {
                          id: "model_1",
                          name: "OpenAI",
                          provider: "openai",
                          model: "gpt-4o"
                        }
                      }
                    ]
                  }
                : path === "/permissions/profiles"
                  ? {
                      profiles: [
                        {
                          id: "profile_1",
                          name: "Default Policy",
                          description: "Shared defaults",
                          rules: []
                        }
                      ]
                    }
                  : path === "/permissions/rules"
                    ? {
                        rules: [
                          {
                            id: "rule_1",
                            workspace_id: "ws_1",
                            resource_type: "file",
                            resource_match: "src/**",
                            action: "allow"
                          }
                        ]
                      }
                    : path === "/skills"
                      ? {
                          skills: [
                            {
                              id: "skill_1",
                              name: "task-planner",
                              description: "Plans tasks",
                              origin: "builtin"
                            }
                          ]
                        }
                      : path === "/deployment-providers"
                        ? {
                            providers: [
                              {
                                id: "provider_1",
                                kind: "caprover",
                                name: "Captain",
                                baseUrl: "https://captain.example",
                                masked: true,
                                hasCredential: true
                              }
                            ]
                          }
                        : path === "/workspaces/ws_1"
                          ? { workspace: { id: "ws_1", name: "Workspace", root_path: "." } }
                          : { path };
            resolve(mockJsonResponse(body));
          });
        });
      });

      const controller = new AbortController();
      const resultPromise = fetchSettingsBootstrap(fetchImpl, controller.signal);

      // First 8 requests fire in parallel immediately.
      expect(calls.map((call) => call.path).sort()).toEqual([
        "/agent-bindings",
        "/deployment-providers",
        "/model-configs",
        "/permissions/profiles",
        "/permissions/rules",
        "/roles",
        "/runtimes",
        "/skills"
      ]);
      expect(calls.every((call) => call.signal === controller.signal)).toBe(true);
      expect(eventSourceSpy).not.toHaveBeenCalled();

      // Resolve all pending fetches, including the sequential workspace fetch that fires
      // after the initial bootstrap Promise.all settles.
      for (let i = 0; i < 10; i++) {
        const batch = pendingResolvers.splice(0, pendingResolvers.length);
        for (const resolve of batch) resolve();
        await Promise.resolve();
      }

      // After resolving, the workspace fetch should have been added.
      expect(calls.map((call) => call.path).sort()).toEqual([
        "/agent-bindings",
        "/deployment-providers",
        "/model-configs",
        "/permissions/profiles",
        "/permissions/rules",
        "/roles",
        "/runtimes",
        "/skills",
        "/workspaces/ws_1"
      ]);
      await expect(resultPromise).resolves.toEqual({
        roles: { path: "/roles" },
        runtimes: { path: "/runtimes" },
        modelConfigs: { path: "/model-configs" },
        agentBindings: {
          agentBindings: [
            {
              id: "binding_1",
              workspaceId: "ws_1",
              role: { name: "Reviewer" },
              runtime: { kind: "native", name: "Native", detectedVersion: "native" },
              modelConfig: { id: "model_1", name: "OpenAI", provider: "openai", model: "gpt-4o" }
            }
          ]
        },
        permissionProfiles: {
          profiles: [
            { id: "profile_1", name: "Default Policy", description: "Shared defaults", rules: [] }
          ]
        },
        permissionRules: {
          rules: [
            {
              id: "rule_1",
              workspace_id: "ws_1",
              resource_type: "file",
              resource_match: "src/**",
              action: "allow"
            }
          ]
        },
        deploymentProviders: {
          providers: [
            {
              id: "provider_1",
              kind: "caprover",
              name: "Captain",
              baseUrl: "https://captain.example",
              masked: true,
              hasCredential: true
            }
          ]
        },
        skills: {
          skills: [
            { id: "skill_1", name: "task-planner", description: "Plans tasks", origin: "builtin" }
          ]
        },
        workspace: { workspace: { id: "ws_1", name: "Workspace", root_path: "." } },
        errors: {}
      });
    } finally {
      Object.defineProperty(globalThis, "EventSource", {
        configurable: true,
        writable: true,
        value: previousEventSource
      });
    }
  });

  it("wires abort signals into every pending settings request", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    });

    const controller = new AbortController();
    const resultPromise = fetchSettingsBootstrap(fetchImpl, controller.signal);
    controller.abort();

    expect(signals).toHaveLength(8);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps successful settings endpoint data when another endpoint fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path === "/permissions/rules") throw new TypeError("Failed to fetch");
      if (path === "/agent-bindings") {
        return jsonResponse(200, {
          agentBindings: [{ id: "binding_1", workspaceId: "ws_1" }]
        });
      }
      if (path === "/workspaces/ws_1") {
        return jsonResponse(200, { workspace: { id: "ws_1", name: "Workspace" } });
      }
      return jsonResponse(200, { path });
    });

    const data = await fetchSettingsBootstrap(fetchImpl, new AbortController().signal);

    expect(data.roles).toEqual({ path: "/roles" });
    expect(data.runtimes).toEqual({ path: "/runtimes" });
    expect(data.skills).toEqual({ path: "/skills" });
    expect(data.deploymentProviders).toEqual({ path: "/deployment-providers" });
    expect(data.permissionRules).toBeUndefined();
    expect(data.workspace).toEqual({ workspace: { id: "ws_1", name: "Workspace" } });
    expect(data.errors).toMatchObject({ permissionRules: "Failed to fetch" });
  });

  it("renders loaded role data even when a different settings endpoint has an error", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        tab: SETTINGS_TABS[0]!,
        loading: false,
        error: undefined,
        data: [{ id: "builder", name: "Builder", prompt: "Build things.", capabilities: [] }],
        allData: {
          roles: [{ id: "builder", name: "Builder", prompt: "Build things.", capabilities: [] }],
          runtimes: undefined,
          modelConfigs: [],
          skills: undefined,
          agentBindings: undefined,
          permissionProfiles: undefined,
          permissionRules: undefined,
          deploymentProviders: undefined,
          workspace: undefined,
          errors: { permissionRules: "Failed to fetch" }
        },
        fetchImpl: vi.fn<typeof fetch>(),
        onRolesChange: vi.fn(),
        onRuntimesChange: vi.fn(),
        onModelConfigsChange: vi.fn(),
        onSkillsChange: vi.fn(),
        onPermissionProfilesChange: vi.fn(),
        onPermissionRulesChange: vi.fn(),
        onDeploymentProvidersChange: vi.fn()
      })
    );

    expect(html).toContain("构建者");
    expect(html).not.toContain("Failed to fetch");
  });

  it("localizes unfinished settings placeholder copy", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        tab: { id: "mcp", label: "MCP" },
        loading: false,
        error: undefined,
        data: undefined,
        allData: {
          roles: undefined,
          runtimes: undefined,
          modelConfigs: undefined,
          skills: undefined,
          agentBindings: undefined,
          permissionProfiles: undefined,
          permissionRules: undefined,
          deploymentProviders: undefined,
          workspace: undefined,
          errors: {}
        },
        fetchImpl: vi.fn<typeof fetch>(),
        onRolesChange: vi.fn(),
        onRuntimesChange: vi.fn(),
        onModelConfigsChange: vi.fn(),
        onSkillsChange: vi.fn(),
        onPermissionProfilesChange: vi.fn(),
        onPermissionRulesChange: vi.fn(),
        onDeploymentProvidersChange: vi.fn()
      })
    );

    expect(html).toContain("只读清单");
    expect(html).toContain("当前仅展示已启用的房间 MCP 工具");
    expect(html).not.toContain("content arrives in later settings tasks");
    expect(html).not.toContain("This shell keeps the data local");
    expect(html).not.toContain("No live subscription is attached");
  });

  it("renders permission profiles and deletable permission rules from REST data", () => {
    const html = renderToStaticMarkup(
      createElement(PermissionsSettingsTab, {
        permissionProfiles: {
          profiles: [{ id: "profile_1", name: "Default Policy", description: "Shared defaults" }],
          settings: { defaultProfileId: "builder-strict", allowAllEnabled: false }
        },
        permissionRules: {
          rules: [
            {
              id: "rule_1",
              workspace_id: "ws_1",
              resource_type: "file",
              resource_match: "src/**",
              action: "allow",
              remember: 1
            }
          ]
        },
        fetchImpl: vi.fn<typeof fetch>(),
        onPermissionProfilesChange: vi.fn(),
        onPermissionRulesChange: vi.fn()
      })
    );

    expect(html).toContain("Default Policy");
    expect(html).toContain("允许全部权限");
    expect(html).toContain("本机开发便利模式");
    expect(html).toContain("许可规则");
    expect(html).toContain("src/**");
    expect(html).toContain("allow");
    expect(html).toContain("删除规则");
    expect(html).toContain("新增规则会在你处理权限请求后自动记录。");
    expect(html).not.toContain("permission-profile-name");
    expect(html).not.toContain("permission-profile-description");
  });

  it("renders workspace metadata as read-only when the daemon only exposes GET /workspaces/:id", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceTab, {
        workspace: {
          workspace: {
            id: "ws_1",
            name: "Workspace",
            root_path: "C:/project/AgentHub",
            updated_at: 1234
          }
        }
      })
    );

    expect(html).toContain("只读");
    expect(html).toContain("当前版本仅支持查看工作区位置。");
    expect(html).toContain("产物存储由本地服务管理");
    expect(html).toContain("工作树模式：");
    expect(html).toContain("垃圾回收：");
    expect(html).toContain("C:/project/AgentHub");
  });

  it("patches the global default permission profile when toggling allow-all mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/permissions/default-profile");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ allowAllEnabled: true });
      return jsonResponse(200, {
        settings: { defaultProfileId: "allow-all-local", allowAllEnabled: true },
        profiles: [
          { id: "builder-strict", name: "Builder Strict", payload: {} },
          { id: "allow-all-local", name: "允许全部权限", payload: {} }
        ]
      });
    });

    await expect(updateDefaultPermissionProfile(fetchImpl, true)).resolves.toEqual({
      profiles: [
        { id: "builder-strict", name: "Builder Strict", payload: {} },
        { id: "allow-all-local", name: "允许全部权限", payload: {} }
      ],
      settings: { defaultProfileId: "allow-all-local", allowAllEnabled: true }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("renders the V1.0 room MCP tools instead of a placeholder-only message", () => {
    const html = renderToStaticMarkup(createElement(McpPlaceholder));

    expect(ROOM_MCP_TOOLS).toEqual([
      "room.delegate",
      "room.read_mailbox",
      "room.create_task",
      "room.update_task",
      "room.list_tasks",
      "room.send_message",
      "room.list_members",
      "room.spawn_agent",
      "room.file",
      "room.shell"
    ]);
    for (const tool of ROOM_MCP_TOOLS) expect(html).toContain(tool);
    expect(html).toContain("只读");
  });

  it("renders CapRover deployment providers with masked credentials and lifecycle actions", () => {
    const normalized = normalizeDeploymentProviders({
      providers: [
        {
          id: "provider_1",
          kind: "caprover",
          name: "Captain",
          base_url: "https://captain.example",
          hasCredential: true,
          masked: true
        }
      ]
    });
    expect(normalized).toEqual([
      expect.objectContaining({
        id: "provider_1",
        kind: "caprover",
        name: "Captain",
        baseUrl: "https://captain.example",
        hasCredential: true,
        masked: true
      })
    ]);

    const html = renderToStaticMarkup(
      createElement(DeployProvidersSettingsTab, {
        providers: { providers: normalized },
        fetchImpl: vi.fn<typeof fetch>(),
        onProvidersChange: vi.fn()
      })
    );

    expect(html).toContain("CapRover");
    expect(html).toContain("Captain");
    expect(html).toContain("https://captain.example");
    expect(html).toContain("凭据已保存");
    expect(html).toContain("测试连接");
    expect(html).toContain("编辑");
    expect(html).toContain("删除");
    expect(html).not.toContain("Vercel");
    expect(html).not.toContain("Cloudflare");
    expect(html).not.toContain("Dokploy");
    expect(html).not.toContain("Coolify");
  });

  it("renders an empty CapRover-only deployment provider state", () => {
    const html = renderToStaticMarkup(
      createElement(DeployProvidersSettingsTab, {
        providers: { providers: [] },
        fetchImpl: vi.fn<typeof fetch>(),
        onProvidersChange: vi.fn()
      })
    );

    expect(html).toContain("添加 CapRover 提供方");
    expect(html).toContain("支持配置 CapRover 自托管部署提供方");
    expect(html).not.toContain("Vercel");
    expect(html).not.toContain("Cloudflare");
  });

  it("uses deployment provider REST endpoints without sending or returning raw tokens after save", async () => {
    const calls: Array<{
      readonly path: string;
      readonly method: string;
      readonly body?: unknown;
    }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({
        path: String(input),
        method: String(init?.method ?? "GET"),
        ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {})
      });
      if (String(input).endsWith("/test"))
        return jsonResponse(200, { ok: true, version: "1.12.0" });
      if (init?.method === "DELETE") return jsonResponse(200, { ok: true });
      return jsonResponse(String(input) === "/deployment-providers" ? 201 : 200, {
        provider: {
          id: "provider_1",
          kind: "caprover",
          name: "Captain",
          baseUrl: "https://captain.example",
          hasCredential: true,
          masked: true
        }
      });
    });

    await expect(
      createDeploymentProvider(fetchImpl, {
        kind: "caprover",
        name: "Captain",
        baseUrl: "https://captain.example",
        credential: "raw-token"
      })
    ).resolves.toMatchObject({ id: "provider_1", hasCredential: true, masked: true });
    await expect(
      updateDeploymentProvider(fetchImpl, "provider_1", {
        name: "Captain Updated",
        baseUrl: "https://captain.example",
        credential: "new-token"
      })
    ).resolves.toMatchObject({ id: "provider_1", hasCredential: true, masked: true });
    await expect(testDeploymentProvider(fetchImpl, "provider_1")).resolves.toEqual({
      ok: true,
      version: "1.12.0"
    });
    await expect(deleteDeploymentProvider(fetchImpl, "provider_1")).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        path: "/deployment-providers",
        method: "POST",
        body: {
          kind: "caprover",
          name: "Captain",
          baseUrl: "https://captain.example",
          credential: "raw-token"
        }
      },
      {
        path: "/deployment-providers/provider_1",
        method: "PATCH",
        body: {
          name: "Captain Updated",
          baseUrl: "https://captain.example",
          credential: "new-token"
        }
      },
      { path: "/deployment-providers/provider_1/test", method: "POST" },
      { path: "/deployment-providers/provider_1", method: "DELETE" }
    ]);
  });

  it("tracks deployment provider test results per provider", () => {
    const existing = {
      provider_2: { ok: false, error: "offline" }
    };

    const withProviderOne = updateDeploymentProviderTestResults(existing, "provider_1", {
      ok: true,
      version: "1.12.0"
    });
    expect(withProviderOne).toEqual({
      provider_1: { ok: true, version: "1.12.0" },
      provider_2: { ok: false, error: "offline" }
    });
    expect(existing).toEqual({
      provider_2: { ok: false, error: "offline" }
    });

    expect(updateDeploymentProviderTestResults(withProviderOne, "provider_2", undefined)).toEqual({
      provider_1: { ok: true, version: "1.12.0" }
    });
  });

  it("clears stale deployment provider test results when provider configuration changes", () => {
    const current = {
      provider_1: { ok: true, version: "1.12.0" },
      provider_2: { ok: false, error: "offline" }
    };
    const nextProviders = [
      {
        id: "provider_1",
        kind: "caprover" as const,
        name: "Captain",
        baseUrl: "https://captain-updated.example",
        hasCredential: true,
        masked: true
      },
      {
        id: "provider_2",
        kind: "caprover" as const,
        name: "Backup",
        baseUrl: "https://backup.example",
        hasCredential: true,
        masked: true
      }
    ];

    expect(
      clearDeploymentProviderTestResultsForChangedProviders(current, nextProviders, ["provider_1"])
    ).toEqual({
      provider_2: { ok: false, error: "offline" }
    });
    expect(
      clearDeploymentProviderTestResultsForChangedProviders(current, nextProviders, ["provider_3"])
    ).toEqual(current);
  });

  it("ignores deployment provider test results from stale provider generations", () => {
    const generations = {
      provider_1: 2,
      provider_2: 1
    };

    expect(shouldApplyDeploymentProviderTestResult(generations, "provider_1", 1)).toBe(false);
    expect(shouldApplyDeploymentProviderTestResult(generations, "provider_1", 2)).toBe(true);
    expect(shouldApplyDeploymentProviderTestResult(generations, "provider_3", 0)).toBe(false);
  });
});

function findElementByProp(
  element: unknown,
  prop: string,
  value: unknown
): { props: Record<string, unknown> } | undefined {
  if (!isValidElement(element)) return undefined;
  const props = element.props as Record<string, unknown>;
  if (props[prop] === value) return { props };

  const children = props.children;
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    const found = findElementByProp(child, prop, value);
    if (found) return found;
  }
  return undefined;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function mockJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload
  } as Response;
}

describe("Skills settings tab contract", () => {
  it("renders Skills settings with builtin badges and workspace skill actions", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsTab, {
        skills: {
          skills: [
            {
              id: "builtin_1",
              name: "task-planner",
              description: "Break work into tasks.",
              content: "---\nname: task-planner\ndescription: Break work into tasks.\n---\n",
              origin: "builtin"
            },
            {
              id: "workspace_1",
              name: "review-helper",
              description: "Review patches.",
              content: "---\nname: review-helper\ndescription: Review patches.\n---\n",
              origin: "workspace"
            }
          ]
        },
        fetchImpl: vi.fn<typeof fetch>(),
        onSkillsChange: vi.fn()
      })
    );

    expect(html).toContain("task-planner");
    expect(html).toContain("内置");
    expect(html).toContain("review-helper");
    expect(html).toContain("工作区");
    expect(html).toContain("新建技能");
    expect(html).toContain("导入");
    expect(html).toContain("查看");
    expect(html).toContain("编辑");
    expect(html).toContain("删除");
  });

  it("renders skill package file counts from REST data", () => {
    const normalized = normalizeSkills({
      skills: [
        {
          id: "workspace_1",
          name: "review-helper",
          description: "Review patches.",
          content: "---\nname: review-helper\ndescription: Review patches.\n---\n",
          origin: "workspace",
          fileCount: 2,
          files: [
            { path: "references/checklist.md", content: "- Check" },
            { path: "scripts/run.sh", content: "echo ok" }
          ]
        }
      ]
    });

    expect(normalized[0]).toMatchObject({
      fileCount: 2,
      files: [{ path: "references/checklist.md" }, { path: "scripts/run.sh" }]
    });

    const html = renderToStaticMarkup(
      createElement(SkillsTab, {
        skills: { skills: normalized },
        fetchImpl: vi.fn<typeof fetch>(),
        onSkillsChange: vi.fn()
      })
    );

    expect(html).toContain("2 个文件");
  });

  it("renders runtime-local skill import controls when runtimes are available", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsTab, {
        skills: { skills: [] },
        runtimes: [
          { id: "runtime-opencode", name: "OpenCode", kind: "opencode", status: "missing" },
          { id: "runtime-codex", name: "Codex", kind: "codex", status: "missing" }
        ],
        fetchImpl: vi.fn<typeof fetch>(),
        onSkillsChange: vi.fn()
      })
    );

    expect(html).toContain("从本地运行时导入");
    expect(html).toContain("OpenCode");
    expect(html).toContain("加载本地技能");
    expect(html).toContain("全选");
  });

  it("normalizes and imports runtime-local skill packages through runtime endpoints", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/runtimes/runtime-opencode/local-skills") {
        return jsonResponse(200, {
          provider: "opencode",
          supported: true,
          roots: ["~/.config/opencode/skills"],
          skills: [
            {
              key: "release/reporter",
              name: "release-reporter",
              description: "Writes reports",
              source_path: "~/.config/opencode/skills/release/reporter",
              file_count: 2
            }
          ]
        });
      }
      if (String(input) === "/runtimes/runtime-opencode/local-skills/import") {
        expect(JSON.parse(String(init?.body))).toEqual({
          skillKey: "release/reporter",
          name: "release-reporter",
          description: "Writes reports"
        });
        return jsonResponse(201, {
          skill: {
            id: "skill_imported",
            name: "release-reporter",
            description: "Writes reports",
            content: "---\nname: release-reporter\ndescription: Writes reports\n---\n",
            origin: "imported",
            fileCount: 1
          },
          files: [{ path: "references/guide.md", content: "Guide" }]
        });
      }
      return jsonResponse(404, { error: "not_found" });
    });

    await expect(fetchRuntimeLocalSkills(fetchImpl, "runtime-opencode")).resolves.toMatchObject({
      provider: "opencode",
      supported: true,
      skills: [{ key: "release/reporter", name: "release-reporter", fileCount: 2 }]
    });
    expect(
      normalizeRuntimeLocalSkillList({
        skills: [
          { key: "shared/reviewer", name: "reviewer", source_path: "~/shared", file_count: 1 }
        ]
      })
    ).toEqual([
      expect.objectContaining({ key: "shared/reviewer", sourcePath: "~/shared", fileCount: 1 })
    ]);
    await expect(
      importRuntimeLocalSkill(fetchImpl, "runtime-opencode", {
        skillKey: "release/reporter",
        name: "release-reporter",
        description: "Writes reports"
      })
    ).resolves.toMatchObject({
      id: "skill_imported",
      files: [{ path: "references/guide.md", content: "Guide" }]
    });
  });

  it("fetches skill package detail before editing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe("/skills/skill_1");
      return jsonResponse(200, {
        skill: {
          id: "skill_1",
          name: "review-helper",
          description: "Review patches.",
          content: "---\nname: review-helper\ndescription: Review patches.\n---\n",
          origin: "workspace",
          fileCount: 1
        },
        files: [{ path: "scripts/run.sh", content: "echo ok" }]
      });
    });

    await expect(fetchSkillDetail(fetchImpl, "skill_1")).resolves.toMatchObject({
      id: "skill_1",
      fileCount: 1,
      files: [{ path: "scripts/run.sh", content: "echo ok" }]
    });
  });

  it("sends supporting files when creating and updating skills", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, {
        skill: {
          id: "skill_1",
          name: "review-helper",
          description: "Review patches.",
          content: "---\nname: review-helper\ndescription: Review patches.\n---\n",
          origin: "workspace",
          fileCount: 1
        },
        files: [{ path: "scripts/run.sh", content: "echo ok" }]
      });
    });
    const input = {
      name: "review-helper",
      description: "Review patches.",
      content: "---\nname: review-helper\ndescription: Review patches.\n---\n",
      files: [{ path: "scripts/run.sh", content: "echo ok" }]
    };

    await createSkill(fetchImpl, input);
    await updateSkill(fetchImpl, "skill_1", input);

    expect(calls).toEqual([input, input]);
  });
});
