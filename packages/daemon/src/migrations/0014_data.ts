import type { AgentHubDatabase } from "@agenthub/db";

type AgentProfileRow = {
  readonly id: string;
  readonly workspace_id: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly avatar: string | null;
  readonly version: string | null;
  readonly provider: string | null;
  readonly default_presence: string | null;
  readonly adapter_id: string;
  readonly model: string | null;
  readonly role_prompt: string;
  readonly capabilities: string;
  readonly permission_profile_id: string | null;
  readonly hidden: number;
  readonly source_path: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

const selectAnyRole = "SELECT 1 AS found FROM roles LIMIT 1";

export function migrateAgentProfilesToV10(database: AgentHubDatabase, now = Date.now()): void {
  const hasRoles = database.sqlite.prepare(selectAnyRole).get() as { readonly found?: number } | undefined;
  if (hasRoles !== undefined) return;

  const profiles = database.sqlite
    .prepare(
      `SELECT id, workspace_id, name, description, avatar, version, provider, default_presence, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at
       FROM agent_profiles
       ORDER BY created_at ASC, id ASC`
    )
    .all() as AgentProfileRow[];
  if (profiles.length === 0) return;

  const runtimeIdByKey = new Map<string, string>();
  const modelConfigIdByKey = new Map<string, string>();
  const insertRole = database.sqlite.prepare(
    `INSERT INTO roles (
      id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  );
  const insertRuntime = database.sqlite.prepare(
    `INSERT INTO runtimes (
      id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, ?, ?, ?)`
  );
  const insertModelConfig = database.sqlite.prepare(
    `INSERT INTO model_configs (
      id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
  );
  const insertBinding = database.sqlite.prepare(
    `INSERT INTO agent_bindings (
      id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateRoomParticipantBinding = database.sqlite.prepare(
    `UPDATE room_participants
     SET agent_binding_id = COALESCE(agent_binding_id, ?)
     WHERE participant_id = ?`
  );
  const updateTaskAssignee = database.sqlite.prepare(
    `UPDATE tasks
     SET assignee_role_id = COALESCE(assignee_role_id, ?),
         assignee_binding_id = COALESCE(assignee_binding_id, ?)
     WHERE assignee_agent_id = ?`
  );

  const resolveRuntimeId = (workspaceId: string | null, adapterId: string): string => {
    const key = `${workspaceId ?? "global"}:${adapterId}`;
    const existing = runtimeIdByKey.get(key);
    if (existing !== undefined) return existing;
    const row = workspaceId === null
      ? database.sqlite.prepare("SELECT id FROM runtimes WHERE workspace_id IS NULL AND kind = ? LIMIT 1").get(adapterId) as { readonly id: string } | undefined
      : database.sqlite.prepare("SELECT id FROM runtimes WHERE workspace_id = ? AND kind = ? LIMIT 1").get(workspaceId, adapterId) as { readonly id: string } | undefined;
    if (row !== undefined) {
      runtimeIdByKey.set(key, row.id);
      return row.id;
    }
    insertRuntime.run(key, workspaceId, adapterId, adapterId, "{}", now, now);
    runtimeIdByKey.set(key, key);
    return key;
  };

  const resolveModelConfigId = (workspaceId: string | null, provider: string, model: string, name: string): string => {
    const key = `${workspaceId ?? "global"}:${provider}:${model}`;
    const existing = modelConfigIdByKey.get(key);
    if (existing !== undefined) return existing;
    const row = workspaceId === null
      ? database.sqlite.prepare("SELECT id FROM model_configs WHERE workspace_id IS NULL AND provider = ? AND model = ? LIMIT 1").get(provider, model) as { readonly id: string } | undefined
      : database.sqlite.prepare("SELECT id FROM model_configs WHERE workspace_id = ? AND provider = ? AND model = ? LIMIT 1").get(workspaceId, provider, model) as { readonly id: string } | undefined;
    if (row !== undefined) {
      modelConfigIdByKey.set(key, row.id);
      return row.id;
    }
    insertModelConfig.run(key, workspaceId, name, provider, model, now, now);
    modelConfigIdByKey.set(key, key);
    return key;
  };

  database.sqlite.transaction(() => {
    for (const profile of profiles) {
      const runtimeId = resolveRuntimeId(profile.workspace_id, profile.adapter_id);
      const modelConfigId = profile.provider !== null && profile.model !== null
        ? resolveModelConfigId(profile.workspace_id, profile.provider, profile.model, profile.name)
        : null;

      insertRole.run(
        profile.id,
        profile.workspace_id,
        profile.name,
        profile.avatar,
        profile.description,
        profile.role_prompt,
        profile.capabilities,
        profile.permission_profile_id,
        null,
        profile.source_path,
        profile.version,
        profile.created_at,
        profile.updated_at
      );
      insertBinding.run(
        profile.id,
        profile.workspace_id,
        profile.id,
        runtimeId,
        modelConfigId,
        profile.permission_profile_id,
        profile.created_at,
        profile.updated_at
      );
      updateRoomParticipantBinding.run(profile.id, profile.id);
      updateTaskAssignee.run(profile.id, profile.id, profile.id);
    }
  })();
}
