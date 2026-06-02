export type RuntimeDefinition = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly detectCommand?: string;
  readonly skillDir?: string;
};

export type RuntimeDetection = {
  readonly path: string;
  readonly version: string | null;
};

export type RuntimeSeedRow = {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly kind: string;
  readonly name: string;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly detectedAt: number | null;
  readonly detectedPath: string | null;
  readonly detectedVersion: string | null;
  readonly supportedCaps: readonly string[];
  readonly version: string | null;
  readonly status: "connected" | "missing" | null;
  readonly manifestJson: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export const TIER2_RUNTIME_KINDS = ["codex", "qwen", "goose", "kimi", "kiro", "hermes"] as const;

export const RUNTIME_DEFINITIONS: readonly RuntimeDefinition[] = [
  { id: "native-default", kind: "native", name: "AgentHub Native", command: null, args: [], skillDir: ".agenthub/skills" },
  { id: "runtime-claude-code", kind: "claude-code", name: "Claude Code", command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@0.29.2"], detectCommand: "claude", skillDir: ".claude/skills" },
  { id: "runtime-opencode", kind: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], detectCommand: "opencode", skillDir: ".opencode/skills" },
  { id: "runtime-codex", kind: "codex", name: "Codex", command: "npx", args: ["-y", "@zed-industries/codex-acp@0.9.5"], detectCommand: "codex", skillDir: ".codex/skills" },
  { id: "runtime-qwen", kind: "qwen", name: "Qwen Code", command: "qwen", args: ["--acp"], detectCommand: "qwen", skillDir: ".qwen/skills" },
  { id: "runtime-goose", kind: "goose", name: "Goose", command: "goose", args: ["acp"], detectCommand: "goose", skillDir: ".goose/skills" },
  { id: "runtime-kimi", kind: "kimi", name: "Kimi CLI", command: "kimi", args: ["acp"], detectCommand: "kimi", skillDir: ".kimi/skills" },
  { id: "runtime-kiro", kind: "kiro", name: "Kiro", command: "kiro-cli", args: ["acp"], detectCommand: "kiro-cli", skillDir: ".kiro/skills" },
  { id: "runtime-hermes", kind: "hermes", name: "Hermes Agent", command: "hermes", args: ["acp"], detectCommand: "hermes" }
] as const;

export function runtimeDefinitionForKind(kind: string): RuntimeDefinition | undefined {
  return RUNTIME_DEFINITIONS.find((definition) => definition.kind === kind);
}

export function runtimeSeedRows(input: { readonly now: number; readonly detections?: ReadonlyMap<string, RuntimeDetection> }): readonly RuntimeSeedRow[] {
  const detections = input.detections ?? new Map<string, RuntimeDetection>();
  return RUNTIME_DEFINITIONS.map((definition) => {
    if (definition.kind === "native") {
      return {
        id: definition.id,
        workspaceId: null,
        kind: definition.kind,
        name: definition.name,
        command: null,
        args: [],
        env: {},
        detectedAt: input.now,
        detectedPath: "agenthub-native",
        detectedVersion: "native",
        supportedCaps: [],
        version: "native",
        status: "connected",
        manifestJson: { runtimeKind: "native", skillDir: definition.skillDir },
        createdAt: input.now,
        updatedAt: input.now
      } satisfies RuntimeSeedRow;
    }
    const detected = detections.get(definition.kind);
    return {
      id: definition.id,
      workspaceId: null,
      kind: definition.kind,
      name: definition.name,
      command: definition.command,
      args: definition.args,
      env: {},
      detectedAt: detected === undefined ? null : input.now,
      detectedPath: detected?.path ?? null,
      detectedVersion: detected?.version ?? null,
      supportedCaps: [],
      version: detected?.version ?? null,
      status: detected === undefined ? "missing" : "connected",
      manifestJson: {
        runtimeKind: definition.kind,
        ...(definition.detectCommand !== undefined ? { detectCommand: definition.detectCommand } : {}),
        ...(definition.skillDir !== undefined ? { skillDir: definition.skillDir } : {})
      },
      createdAt: input.now,
      updatedAt: input.now
    } satisfies RuntimeSeedRow;
  });
}
