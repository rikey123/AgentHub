import { describe, expect, it } from "vitest";

import { TIER2_RUNTIME_KINDS, runtimeDefinitionForKind, runtimeSeedRows } from "../src/runtime-catalog.ts";

describe("runtime catalog", () => {
  it("defines Tier 2 runtimes with concrete launch commands and ACP args", () => {
    expect(TIER2_RUNTIME_KINDS).toEqual(["codex", "qwen", "goose", "kimi", "kiro", "hermes"]);

    expect(runtimeDefinitionForKind("claude-code")).toMatchObject({
      kind: "claude-code",
      command: process.execPath,
      args: [expect.stringMatching(/[\\/]npm-acp-runner\.mjs$/u), "@agentclientprotocol/claude-agent-acp@0.44.0", "claude-agent-acp"],
      detectCommand: "claude"
    });
    expect(runtimeDefinitionForKind("codex")).toMatchObject({
      kind: "codex",
      command: process.execPath,
      args: [expect.stringMatching(/[\\/]npm-acp-runner\.mjs$/u), "@zed-industries/codex-acp@0.15.0", "codex-acp"],
      detectCommand: "codex"
    });
    expect(runtimeDefinitionForKind("qwen")).toMatchObject({ kind: "qwen", command: "qwen", args: ["--acp"] });
    expect(runtimeDefinitionForKind("goose")).toMatchObject({ kind: "goose", command: "goose", args: ["acp"] });
    expect(runtimeDefinitionForKind("kimi")).toMatchObject({ kind: "kimi", command: "kimi", args: ["acp"] });
    expect(runtimeDefinitionForKind("kiro")).toMatchObject({ kind: "kiro", command: "kiro-cli", args: ["acp"] });
    expect(runtimeDefinitionForKind("hermes")).toMatchObject({ kind: "hermes", command: "hermes", args: ["acp"] });
  });

  it("builds seed rows that keep missing runtimes visible without turning them into mock", () => {
    const rows = runtimeSeedRows({
      now: 123,
      detections: new Map([
        ["codex", { path: "C:/bin/codex.cmd", version: "codex 1.0.0" }]
      ])
    });

    expect(rows.find((row) => row.id === "runtime-codex")).toMatchObject({
      kind: "codex",
      status: "connected",
      detectedPath: "C:/bin/codex.cmd",
      detectedVersion: "codex 1.0.0"
    });
    expect(rows.find((row) => row.id === "runtime-codex")?.env.NPM_CONFIG_CACHE).toMatch(/[\\/]\.agenthub[\\/]npm-cache$/u);
    expect(rows.find((row) => row.id === "runtime-qwen")).toMatchObject({
      kind: "qwen",
      status: "missing",
      detectedPath: null,
      detectedVersion: null
    });
  });
});

