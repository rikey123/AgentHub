import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField
} from "@heroui/react";
import {
  skillDisplayDescription,
  skillDisplayName,
  skillOriginColor,
  skillOriginLabel
} from "../../lib/skills.ts";
import { normalizeRuntimeList, type RuntimeConfig } from "./RuntimesTab.tsx";

export type SkillOrigin = "builtin" | "workspace" | "imported" | string;

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  content: string;
  origin: SkillOrigin;
  source_url?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  file_count?: number | undefined;
  fileCount?: number | undefined;
  files?: SkillFileConfig[] | undefined;
}

export interface SkillFileConfig {
  id?: string | undefined;
  skill_id?: string | undefined;
  skillId?: string | undefined;
  path: string;
  content: string;
}

interface SkillsTabProps {
  skills: unknown;
  runtimes?: unknown;
  fetchImpl?: typeof fetch;
  onSkillsChange?: (skills: SkillConfig[]) => void;
}

type SkillEditorMode = "view" | "create" | "edit";

interface SkillDraft {
  id?: string | undefined;
  mode: SkillEditorMode;
  name: string;
  description: string;
  content: string;
  origin?: SkillOrigin | undefined;
  files: SkillFileConfig[];
  selectedPath: string;
  newFilePath: string;
}

export interface RuntimeLocalSkillConfig {
  key: string;
  name: string;
  description?: string | undefined;
  sourcePath: string;
  provider: string;
  fileCount: number;
}

export interface RuntimeLocalSkillsResponse {
  provider: string;
  supported: boolean;
  roots: string[];
  skills: RuntimeLocalSkillConfig[];
}

type LocalSkillEdit = {
  name: string;
  description: string;
};

const DEFAULT_SKILL_CONTENT =
  "---\nname: new-skill\ndescription: 说明这个技能能帮什么忙。\n---\n\n在这里补充清晰的使用说明。";
const SKILL_MD_PATH = "SKILL.md";

export function SkillsTab({
  skills: initialSkills,
  runtimes: runtimeData,
  fetchImpl = fetch,
  onSkillsChange
}: SkillsTabProps) {
  const [skills, setSkills] = useState<SkillConfig[]>(() => normalizeSkills(initialSkills));
  const runtimeOptions = useMemo(() => normalizeRuntimeList(runtimeData), [runtimeData]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>(
    () => runtimeOptions[0]?.id ?? ""
  );
  const [localResponse, setLocalResponse] = useState<RuntimeLocalSkillsResponse | undefined>();
  const [selectedLocalKeys, setSelectedLocalKeys] = useState<Set<string>>(() => new Set());
  const [localEdits, setLocalEdits] = useState<Record<string, LocalSkillEdit>>({});
  const [draft, setDraft] = useState<SkillDraft | undefined>();
  const [importUrl, setImportUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [importingLocal, setImportingLocal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setSkills(normalizeSkills(initialSkills));
  }, [initialSkills]);

  useEffect(() => {
    if (runtimeOptions.length === 0) {
      setSelectedRuntimeId("");
      return;
    }
    if (!runtimeOptions.some((runtime) => runtime.id === selectedRuntimeId))
      setSelectedRuntimeId(runtimeOptions[0]?.id ?? "");
  }, [runtimeOptions, selectedRuntimeId]);

  const sortedSkills = useMemo(() => sortSkills(skills), [skills]);
  const selectedRuntime = runtimeOptions.find((runtime) => runtime.id === selectedRuntimeId);
  const localSkills = localResponse?.skills ?? [];
  const selectedLocalSkill =
    selectedLocalKeys.size === 1
      ? localSkills.find((skill) => selectedLocalKeys.has(skill.key))
      : undefined;

  const updateSkills = (nextSkills: SkillConfig[]) => {
    const sorted = sortSkills(nextSkills);
    setSkills(sorted);
    onSkillsChange?.(sorted);
  };

  const openNewSkill = () => {
    setDraft({
      mode: "create",
      name: "new-skill",
      description: "说明这个技能能帮什么忙。",
      content: DEFAULT_SKILL_CONTENT,
      files: [],
      selectedPath: SKILL_MD_PATH,
      newFilePath: ""
    });
    setMessage(undefined);
    setError(undefined);
  };

  const openSkill = async (skill: SkillConfig, mode: SkillEditorMode) => {
    setDraft(draftFromSkill(skill, mode));
    setMessage(undefined);
    setError(undefined);
    try {
      const detail = await fetchSkillDetail(fetchImpl, skill.id);
      setDraft(draftFromSkill(detail, mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveDraft = async () => {
    if (!draft || draft.mode === "view") return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        content: draft.content,
        files: draft.files
      };
      const saved =
        draft.mode === "edit" && draft.id
          ? await updateSkill(fetchImpl, draft.id, input)
          : await createSkill(fetchImpl, input);
      updateSkills(upsertSkill(skills, saved));
      setDraft(draftFromSkill(saved, saved.origin === "builtin" ? "view" : "edit"));
      setMessage(draft.mode === "edit" ? "技能已保存。" : "技能已创建。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const importFromUrl = async () => {
    if (importUrl.trim().length === 0) return;
    setImporting(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const imported = await importSkill(fetchImpl, importUrl.trim());
      updateSkills(upsertSkill(skills, imported));
      setImportUrl("");
      setMessage("技能已导入。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const loadLocalSkills = async () => {
    if (!selectedRuntimeId) return;
    setLoadingLocal(true);
    setError(undefined);
    setMessage(undefined);
    setSelectedLocalKeys(new Set());
    setLocalEdits({});
    try {
      const response = await fetchRuntimeLocalSkills(fetchImpl, selectedRuntimeId);
      setLocalResponse(response);
      if (!response.supported)
        setMessage(`运行时 ${selectedRuntime?.name ?? selectedRuntimeId} 未暴露本地技能目录。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLocal(false);
    }
  };

  const selectRuntime = (runtimeId: string) => {
    setSelectedRuntimeId(runtimeId);
    setLocalResponse(undefined);
    setSelectedLocalKeys(new Set());
    setLocalEdits({});
  };

  const setLocalSkillSelected = (skillKey: string, selected: boolean) => {
    setSelectedLocalKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(skillKey);
      else next.delete(skillKey);
      return next;
    });
  };

  const setAllLocalSkillsSelected = (selected: boolean) => {
    setSelectedLocalKeys(selected ? new Set(localSkills.map((skill) => skill.key)) : new Set());
  };

  const patchLocalEdit = (skillKey: string, patch: Partial<LocalSkillEdit>) => {
    const skill = localSkills.find((candidate) => candidate.key === skillKey);
    if (skill === undefined) return;
    setLocalEdits((current) => ({
      ...current,
      [skillKey]: {
        name: current[skillKey]?.name ?? skill.name,
        description: current[skillKey]?.description ?? skill.description ?? "",
        ...patch
      }
    }));
  };

  const importSelectedLocalSkills = async () => {
    if (!selectedRuntimeId || selectedLocalKeys.size === 0) return;
    setImportingLocal(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const imported: SkillConfig[] = [];
      for (const skill of localSkills.filter((candidate) => selectedLocalKeys.has(candidate.key))) {
        const edit = localEdits[skill.key];
        imported.push(
          await importRuntimeLocalSkill(fetchImpl, selectedRuntimeId, {
            skillKey: skill.key,
            name: edit?.name ?? skill.name,
            description:
              edit?.description ??
              skill.description ??
              `从 ${localResponse?.provider ?? selectedRuntimeId} 导入`
          })
        );
      }
      updateSkills(imported.reduce((current, skill) => upsertSkill(current, skill), skills));
      setSelectedLocalKeys(new Set());
      setMessage(`已导入 ${imported.length} 个本地技能。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingLocal(false);
    }
  };

  const deleteWorkspaceSkill = async (skill: SkillConfig) => {
    if (skill.origin === "builtin") return;
    setDeletingId(skill.id);
    setError(undefined);
    setMessage(undefined);
    try {
      await deleteSkill(fetchImpl, skill.id);
      updateSkills(skills.filter((candidate) => candidate.id !== skill.id));
      if (draft?.id === skill.id) setDraft(undefined);
      setMessage("技能已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(undefined);
    }
  };

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-skills">
      <Card variant="default" className="border border-border bg-overlay">
        <Card.Header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Card.Title>技能</Card.Title>
              <Card.Description>管理可供 rooms 和 agents 使用的标准 SKILL.md 包。</Card.Description>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onPress={() => void importFromUrl()}
                isPending={importing}
                isDisabled={importUrl.trim().length === 0}
              >
                导入
              </Button>
              <Button size="sm" variant="primary" onPress={openNewSkill}>
                新建技能
              </Button>
            </div>
          </div>
        </Card.Header>
        <Card.Content className="grid gap-4">
          <TextField value={importUrl} onChange={setImportUrl}>
            <Label className="text-sm font-semibold">导入 URL</Label>
            <Input placeholder="https://example.com/SKILL.md" data-testid="skills-import-url" />
          </TextField>

          {message ? (
            <p className="text-xs text-success" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {sortedSkills.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
              /skills 暂未返回技能。
            </div>
          ) : (
            <div className="grid gap-2">
              {sortedSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="grid gap-3 rounded-2xl border border-border bg-surface px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  data-testid={`skill-row-${skill.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {skillDisplayName(skill)}
                      </span>
                      <Chip size="sm" variant="soft" color={skillOriginColor(skill.origin)}>
                        {skillOriginLabel(skill.origin)}
                      </Chip>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {skillDisplayDescription(skill) || "无描述。"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Chip size="sm" variant="soft">
                        {skillFileCountLabel(skill)}
                      </Chip>
                      {skill.source_url || skill.sourceUrl ? (
                        <span className="max-w-full truncate text-xs text-muted ah-mono">
                          {skill.source_url ?? skill.sourceUrl}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void openSkill(skill, "view")}
                    >
                      查看
                    </Button>
                    {skill.origin !== "builtin" ? (
                      <Button
                        size="sm"
                        variant="tertiary"
                        onPress={() => void openSkill(skill, "edit")}
                      >
                        编辑
                      </Button>
                    ) : null}
                    {skill.origin !== "builtin" ? (
                      <Button
                        size="sm"
                        variant="danger"
                        isPending={deletingId === skill.id}
                        onPress={() => void deleteWorkspaceSkill(skill)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>

      <Card variant="default" className="border border-border bg-overlay">
        <Card.Header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Card.Title>从本地运行时导入</Card.Title>
              <Card.Description>
                浏览 Claude Code、Codex、OpenCode 和其他本地运行时中已安装的标准 SKILL.md 包。
              </Card.Description>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => void loadLocalSkills()}
              isPending={loadingLocal}
              isDisabled={!selectedRuntimeId}
            >
              加载本地技能
            </Button>
          </div>
        </Card.Header>
        <Card.Content className="grid gap-4">
          <RuntimeSelect
            runtimes={runtimeOptions}
            value={selectedRuntimeId}
            onChange={selectRuntime}
          />

          {localResponse ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Chip
                  size="sm"
                  variant="soft"
                  color={localResponse.supported ? "success" : "warning"}
                >
                  {localResponse.provider}
                </Chip>
                <span>
                  {localResponse.supported
                    ? `找到 ${localSkills.length} 个包`
                    : "不支持本地技能发现"}
                </span>
                {localResponse.roots.length > 0 ? (
                  <span className="truncate ah-mono">{localResponse.roots.join(" · ")}</span>
                ) : null}
              </div>

              <Checkbox
                isSelected={localSkills.length > 0 && selectedLocalKeys.size === localSkills.length}
                onChange={setAllLocalSkillsSelected}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>
                  <Label className="text-sm font-semibold">全选</Label>
                </Checkbox.Content>
              </Checkbox>

              {localSkills.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
                  此运行时未找到本地技能包。
                </div>
              ) : (
                <div className="grid gap-2">
                  {localSkills.map((skill) => (
                    <Checkbox
                      key={skill.key}
                      isSelected={selectedLocalKeys.has(skill.key)}
                      onChange={(selected) => setLocalSkillSelected(skill.key, selected)}
                      className="rounded-2xl border border-border bg-surface px-3 py-3"
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Content>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold">
                              {skillDisplayName(skill)}
                            </span>
                            <Chip size="sm" variant="soft">
                              {skill.fileCount} 个文件
                            </Chip>
                            <span className="ah-mono text-xs text-muted">{skill.key}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted">
                            {skillDisplayDescription(skill) || "无描述。"}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted ah-mono">
                            {skill.sourcePath}
                          </p>
                        </div>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                </div>
              )}

              {selectedLocalSkill ? (
                <div className="grid gap-3 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-2">
                  <TextField
                    value={localEdits[selectedLocalSkill.key]?.name ?? selectedLocalSkill.name}
                    onChange={(value) => patchLocalEdit(selectedLocalSkill.key, { name: value })}
                  >
                    <Label className="text-sm font-semibold">导入名称</Label>
                    <Input placeholder={selectedLocalSkill.name} />
                  </TextField>
                  <TextField
                    value={
                      localEdits[selectedLocalSkill.key]?.description ??
                      selectedLocalSkill.description ??
                      ""
                    }
                    onChange={(value) =>
                      patchLocalEdit(selectedLocalSkill.key, { description: value })
                    }
                  >
                    <Label className="text-sm font-semibold">导入描述</Label>
                    <Input placeholder={selectedLocalSkill.description ?? "描述此技能"} />
                  </TextField>
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  isPending={importingLocal}
                  isDisabled={selectedLocalKeys.size === 0 || importingLocal}
                  onPress={() => void importSelectedLocalSkills()}
                >
                  导入所选
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <Checkbox
                isSelected={false}
                isDisabled
                onChange={() => undefined}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>
                  <Label className="text-sm font-semibold">全选</Label>
                </Checkbox.Content>
              </Checkbox>
              <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
                选择运行时并加载本地技能，以导入现有包及其支持文件。
              </div>
            </div>
          )}
        </Card.Content>
      </Card>

      <SkillEditorModal
        draft={draft}
        saving={saving}
        error={error}
        onChange={setDraft}
        onClose={() => setDraft(undefined)}
        onSave={() => void saveDraft()}
      />
    </section>
  );
}

function RuntimeSelect({
  runtimes,
  value,
  onChange
}: {
  runtimes: readonly RuntimeConfig[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedRuntime = runtimes.find((runtime) => runtime.id === value);
  return (
    <Select
      aria-label="用于本地技能导入的运行时"
      className="w-full"
      fullWidth
      selectedKey={value}
      isDisabled={runtimes.length === 0}
      placeholder="选择运行时"
      variant="secondary"
      onSelectionChange={(key: unknown) => onChange(selectValue(key))}
    >
      <Label className="text-sm font-semibold">运行时</Label>
      <Select.Trigger
        className="min-h-12 bg-field-background"
        data-testid="skills-local-runtime-select"
      >
        <Select.Value>
          <span className="truncate font-semibold">
            {selectedRuntime ? runtimeLabel(selectedRuntime) : "选择运行时"}
          </span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="max-h-72">
        <ListBox aria-label="用于本地技能导入的运行时">
          {runtimes.map((runtime) => (
            <ListBox.Item key={runtime.id} id={runtime.id} textValue={runtime.name}>
              <div className="flex min-w-0 items-center gap-2 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{runtime.name}</div>
                  <div className="truncate text-xs text-muted">{runtime.kind}</div>
                </div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={runtime.status === "connected" ? "success" : "default"}
                >
                  {runtime.status ?? "ready"}
                </Chip>
                <ListBox.ItemIndicator />
              </div>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function runtimeLabel(runtime: RuntimeConfig): string {
  return `${runtime.name} (${runtime.kind})`;
}

function selectValue(key: unknown): string {
  if (typeof key === "string") return key;
  if (key instanceof Set) return String(Array.from(key)[0] ?? "");
  return "";
}

export function normalizeSkills(payload: unknown): SkillConfig[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.skills)
      ? payload.skills
      : [];
  return sortSkills(
    rows.map(normalizeSkill).filter((skill): skill is SkillConfig => skill !== undefined)
  );
}

export function normalizeRuntimeLocalSkillList(payload: unknown): RuntimeLocalSkillConfig[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.skills)
      ? payload.skills
      : [];
  return rows
    .flatMap((raw) => {
      if (!isRecord(raw) || typeof raw.key !== "string" || typeof raw.name !== "string") return [];
      const fileCount = numberField(raw.fileCount) ?? numberField(raw.file_count) ?? 1;
      return [
        {
          key: raw.key,
          name: raw.name,
          ...(typeof raw.description === "string" ? { description: raw.description } : {}),
          sourcePath:
            typeof raw.sourcePath === "string"
              ? raw.sourcePath
              : typeof raw.source_path === "string"
                ? raw.source_path
                : "",
          provider: typeof raw.provider === "string" ? raw.provider : "",
          fileCount
        }
      ];
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeRuntimeLocalSkillsResponse(payload: unknown): RuntimeLocalSkillsResponse {
  const record = isRecord(payload) ? payload : {};
  return {
    provider: typeof record.provider === "string" ? record.provider : "",
    supported: record.supported !== false,
    roots: Array.isArray(record.roots)
      ? record.roots.filter((root): root is string => typeof root === "string")
      : [],
    skills: normalizeRuntimeLocalSkillList(record)
  };
}

type SkillWriteInput = {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly files?: ReadonlyArray<SkillFileConfig>;
};

export async function createSkill(
  fetchImpl: typeof fetch,
  input: SkillWriteInput
): Promise<SkillConfig> {
  return writeSkill(fetchImpl, "/skills", "POST", input);
}

export async function updateSkill(
  fetchImpl: typeof fetch,
  skillId: string,
  input: SkillWriteInput
): Promise<SkillConfig> {
  return writeSkill(fetchImpl, `/skills/${encodeURIComponent(skillId)}`, "PUT", input);
}

export async function importSkill(fetchImpl: typeof fetch, url: string): Promise<SkillConfig> {
  return writeSkill(fetchImpl, "/skills/import", "POST", { url });
}

export async function fetchRuntimeLocalSkills(
  fetchImpl: typeof fetch,
  runtimeId: string
): Promise<RuntimeLocalSkillsResponse> {
  const response = await fetchImpl(`/runtimes/${encodeURIComponent(runtimeId)}/local-skills`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw await skillApiError(response, "获取本地运行时技能失败");
  return normalizeRuntimeLocalSkillsResponse(await response.json());
}

export async function importRuntimeLocalSkill(
  fetchImpl: typeof fetch,
  runtimeId: string,
  input: { readonly skillKey: string; readonly name?: string; readonly description?: string }
): Promise<SkillConfig> {
  return writeSkill(
    fetchImpl,
    `/runtimes/${encodeURIComponent(runtimeId)}/local-skills/import`,
    "POST",
    input
  );
}

export async function fetchSkillDetail(
  fetchImpl: typeof fetch,
  skillId: string
): Promise<SkillConfig> {
  const response = await fetchImpl(`/skills/${encodeURIComponent(skillId)}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw await skillApiError(response, "获取技能详情失败");
  const skill = normalizeSkill(await response.json());
  if (!skill) throw new Error("技能响应中没有包含技能。");
  return skill;
}

export async function deleteSkill(fetchImpl: typeof fetch, skillId: string): Promise<void> {
  const response = await fetchImpl(`/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw await skillApiError(response, "删除技能失败");
}

function SkillEditorModal({
  draft,
  saving,
  error,
  onChange,
  onClose,
  onSave
}: {
  draft: SkillDraft | undefined;
  saving: boolean;
  error: string | undefined;
  onChange: (draft: SkillDraft | undefined) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const readOnly = draft?.mode === "view" || draft?.origin === "builtin";
  const canSave =
    draft !== undefined &&
    !readOnly &&
    draft.name.trim().length > 0 &&
    draft.description.trim().length > 0 &&
    draft.content.trim().length > 0;
  const selectedPath = draft?.selectedPath ?? SKILL_MD_PATH;
  const selectedSupportingFile = draft?.files.find((file) => file.path === selectedPath);
  const selectedContent =
    selectedPath === SKILL_MD_PATH
      ? (draft?.content ?? "")
      : (selectedSupportingFile?.content ?? "");

  const selectPath = (path: string) => {
    if (!draft) return;
    onChange({ ...draft, selectedPath: path });
  };

  const updateSelectedContent = (content: string) => {
    if (!draft) return;
    if (selectedPath === SKILL_MD_PATH) {
      onChange({ ...draft, content });
      return;
    }
    onChange({
      ...draft,
      files: draft.files.map((file) => (file.path === selectedPath ? { ...file, content } : file))
    });
  };

  const renameSelectedFile = (path: string) => {
    if (!draft || selectedPath === SKILL_MD_PATH) return;
    onChange({
      ...draft,
      selectedPath: path,
      files: draft.files.map((file) => (file.path === selectedPath ? { ...file, path } : file))
    });
  };

  const addSupportingFile = () => {
    if (!draft) return;
    const path = draft.newFilePath.trim();
    if (
      path.length === 0 ||
      path.toLowerCase() === "skill.md" ||
      draft.files.some((file) => file.path === path)
    )
      return;
    onChange({
      ...draft,
      files: [...draft.files, { path, content: "" }],
      selectedPath: path,
      newFilePath: ""
    });
  };

  const deleteSelectedFile = () => {
    if (!draft || selectedPath === SKILL_MD_PATH) return;
    onChange({
      ...draft,
      files: draft.files.filter((file) => file.path !== selectedPath),
      selectedPath: SKILL_MD_PATH
    });
  };

  return (
    <Modal.Backdrop
      isOpen={draft !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container size="lg">
        <Modal.Dialog className="sm:max-w-[860px]" aria-label="技能编辑器">
          <Modal.CloseTrigger aria-label="关闭技能编辑器" />
          <Modal.Header>
            <div className="min-w-0">
              <Modal.Heading>
                {draft?.mode === "create"
                  ? "新建技能"
                  : draft?.mode === "edit"
                    ? "编辑技能"
                    : "查看技能"}
              </Modal.Heading>
              {draft?.origin ? (
                <p className="mt-1 text-xs text-muted">{skillOriginLabel(draft.origin)}技能</p>
              ) : null}
            </div>
          </Modal.Header>
          <Modal.Body>
            {draft ? (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    value={draft.name}
                    onChange={(value) => onChange({ ...draft, name: value })}
                    isReadOnly={readOnly}
                  >
                    <Label className="text-sm font-semibold">名称</Label>
                    <Input placeholder="skill-name" data-testid="skills-name-input" />
                  </TextField>
                  <TextField
                    value={draft.description}
                    onChange={(value) => onChange({ ...draft, description: value })}
                    isReadOnly={readOnly}
                  >
                    <Label className="text-sm font-semibold">描述</Label>
                    <Input
                      placeholder="说明此技能能帮什么忙"
                      data-testid="skills-description-input"
                    />
                  </TextField>
                </div>

                <div className="grid min-h-[420px] gap-4 lg:grid-cols-[260px_1fr]">
                  <div className="grid content-start gap-3 rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">包文件</p>
                      <Chip size="sm" variant="soft">
                        {draft.files.length + 1} 个文件
                      </Chip>
                    </div>
                    <div className="grid gap-1">
                      <Button
                        size="sm"
                        variant={selectedPath === SKILL_MD_PATH ? "secondary" : "ghost"}
                        className="justify-start ah-mono"
                        onPress={() => selectPath(SKILL_MD_PATH)}
                      >
                        SKILL.md
                      </Button>
                      {draft.files
                        .slice()
                        .sort((a, b) => a.path.localeCompare(b.path))
                        .map((file) => (
                          <Button
                            key={file.path}
                            size="sm"
                            variant={selectedPath === file.path ? "secondary" : "ghost"}
                            className="justify-start truncate ah-mono"
                            onPress={() => selectPath(file.path)}
                          >
                            {file.path}
                          </Button>
                        ))}
                    </div>
                    {!readOnly ? (
                      <div className="grid gap-2 border-t border-border pt-3">
                        <TextField
                          value={draft.newFilePath}
                          onChange={(value) => onChange({ ...draft, newFilePath: value })}
                        >
                          <Label className="text-xs font-semibold">添加文件</Label>
                          <Input placeholder="scripts/run.sh" data-testid="skills-new-file-input" />
                        </TextField>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={addSupportingFile}
                          isDisabled={draft.newFilePath.trim().length === 0}
                        >
                          添加文件
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid content-start gap-3">
                    {selectedPath !== SKILL_MD_PATH ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <TextField
                          value={selectedPath}
                          onChange={renameSelectedFile}
                          isReadOnly={readOnly}
                        >
                          <Label className="text-sm font-semibold">文件路径</Label>
                          <Input
                            className="ah-mono"
                            placeholder="references/example.md"
                            data-testid="skills-file-path-input"
                          />
                        </TextField>
                        {!readOnly ? (
                          <Button variant="danger" onPress={deleteSelectedFile}>
                            删除文件
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <TextField
                      value={selectedContent}
                      onChange={updateSelectedContent}
                      isReadOnly={readOnly}
                    >
                      <Label className="text-sm font-semibold">{selectedPath}</Label>
                      <TextArea
                        className="min-h-[340px] ah-mono text-xs"
                        placeholder={
                          selectedPath === SKILL_MD_PATH ? DEFAULT_SKILL_CONTENT : "文件内容"
                        }
                        data-testid="skills-content-input"
                      />
                    </TextField>
                  </div>
                </div>
                {error ? (
                  <p className="text-xs text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer className="gap-2">
            <Button variant="secondary" onPress={onClose}>
              关闭
            </Button>
            {!readOnly ? (
              <Button
                variant="primary"
                isPending={saving}
                isDisabled={!canSave || saving}
                onPress={onSave}
              >
                保存
              </Button>
            ) : null}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

async function writeSkill(
  fetchImpl: typeof fetch,
  path: string,
  method: "POST" | "PUT",
  input: unknown
): Promise<SkillConfig> {
  const response = await fetchImpl(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await skillApiError(response, `${method} 技能失败`);
  const skill = normalizeSkill(await response.json());
  if (!skill) throw new Error("技能响应中没有包含技能。");
  return skill;
}

async function skillApiError(response: Response, fallback: string): Promise<Error> {
  const payload = await readJson(response);
  if (isRecord(payload)) {
    if (typeof payload.message === "string" && payload.message.length > 0)
      return new Error(payload.message);
    if (typeof payload.error === "string" && payload.error.length > 0)
      return new Error(payload.error);
  }
  return new Error(`${fallback}: HTTP ${response.status}`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function normalizeSkill(raw: unknown): SkillConfig | undefined {
  const value = isRecord(raw) && isRecord(raw.skill) ? raw.skill : raw;
  const rawFiles =
    isRecord(raw) && Array.isArray(raw.files)
      ? raw.files
      : isRecord(value) && Array.isArray(value.files)
        ? value.files
        : [];
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string")
    return undefined;
  const files = normalizeSkillFiles(rawFiles);
  const fileCount = numberField(value.fileCount) ?? numberField(value.file_count) ?? files.length;
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
    content: typeof value.content === "string" ? value.content : "",
    origin: typeof value.origin === "string" ? value.origin : "workspace",
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    sourceUrl: typeof value.sourceUrl === "string" ? value.sourceUrl : null,
    file_count: fileCount,
    fileCount,
    files
  };
}

function normalizeSkillFiles(rawFiles: readonly unknown[]): SkillFileConfig[] {
  return rawFiles
    .flatMap((file) => {
      if (!isRecord(file) || typeof file.path !== "string" || typeof file.content !== "string")
        return [];
      return [
        {
          ...(typeof file.id === "string" ? { id: file.id } : {}),
          ...(typeof file.skill_id === "string" ? { skill_id: file.skill_id } : {}),
          ...(typeof file.skillId === "string" ? { skillId: file.skillId } : {}),
          path: file.path,
          content: file.content
        }
      ];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function draftFromSkill(skill: SkillConfig, mode: SkillEditorMode): SkillDraft {
  return {
    id: skill.id,
    mode,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    origin: skill.origin,
    files: normalizeSkillFiles(skill.files ?? []),
    selectedPath: SKILL_MD_PATH,
    newFilePath: ""
  };
}

function skillFileCountLabel(skill: SkillConfig): string {
  const count = skill.fileCount ?? skill.file_count ?? skill.files?.length ?? 0;
  return `${count} 个文件`;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function upsertSkill(skills: ReadonlyArray<SkillConfig>, skill: SkillConfig): SkillConfig[] {
  return sortSkills([...skills.filter((candidate) => candidate.id !== skill.id), skill]);
}

function sortSkills(skills: ReadonlyArray<SkillConfig>): SkillConfig[] {
  return skills.slice().sort((a, b) => {
    const origin = originRank(a.origin) - originRank(b.origin);
    return origin === 0 ? a.name.localeCompare(b.name) : origin;
  });
}

function originRank(origin: SkillOrigin): number {
  if (origin === "builtin") return 0;
  if (origin === "workspace") return 1;
  return 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
