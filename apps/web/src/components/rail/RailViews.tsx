import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, Button, Card, Chip, Input, Label, ListBox, Modal, ScrollShadow, Select, Spinner, TextArea, TextField } from "@heroui/react";
import type { AgentContactViewModel } from "../../types.ts";
import { ArtifactPreviewModal, normalizePreviewKind, type ArtifactChatReference } from "../artifacts/ArtifactPreviewModal.tsx";

export type ArtifactLibraryItem = {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly filename?: string | undefined;
  readonly latestVersion?: number | undefined;
  readonly roomId?: string | undefined;
  readonly createdBy?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly updatedAt?: number | undefined;
  readonly filePath?: string | undefined;
};

type RailViewState<T> = {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly error?: string | undefined;
};

type ArtifactPreviewState = {
  readonly item: ArtifactLibraryItem;
  readonly content?: string | undefined;
  readonly error?: string | undefined;
  readonly loading?: boolean | undefined;
};
type ContactRuntimeHealth = NonNullable<AgentContactViewModel["runtimeHealth"]>;
type RuntimeOption = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly version?: string | undefined;
  readonly status?: string | undefined;
};
type NewAgentDraft = {
  readonly name: string;
  readonly runtimeId: string;
  readonly runtimeKind?: string | undefined;
  readonly runtimeName?: string | undefined;
  readonly description: string;
  readonly systemPrompt: string;
};

export function ContactsRailContainer({ fetchImpl, onStartChat, onEditContact, onConfigureContact }: { readonly fetchImpl: typeof fetch; readonly onStartChat?: ((contact: AgentContactViewModel) => void) | undefined; readonly onEditContact?: ((contact: AgentContactViewModel) => void) | undefined; readonly onConfigureContact?: ((contact: AgentContactViewModel) => void) | undefined }) {
  const [state, setState] = useState<RailViewState<AgentContactViewModel>>({ items: [], loading: true });
  const [editingContact, setEditingContact] = useState<AgentContactViewModel | undefined>(undefined);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [testingId, setTestingId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void fetchImpl("/agents/contacts", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(`contacts ${response.status}`);
        return normalizeAgentContacts(payload);
      })
      .then((contacts) => {
        if (!cancelled) setState({ items: contacts, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ items: [], loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  const updateContact = (contact: AgentContactViewModel) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item) => item.agentBindingId === contact.agentBindingId ? { ...item, ...contact } : item)
    }));
  };

  const testConnection = async (contact: AgentContactViewModel) => {
    const runtimeId = contact.runtimeId;
    if (!runtimeId) {
      updateContact({ ...contact, runtimeHealth: { status: "error", error: "缺少 Runtime ID" } });
      return;
    }
    setTestingId(contact.agentBindingId);
    try {
      updateContact({ ...contact, runtimeHealth: await testContactRuntimeConnection(fetchImpl, runtimeId, contact.runtimeKind) });
    } finally {
      setTestingId(undefined);
    }
  };

  return (
    <>
      <ContactsRailView
        contacts={state.items}
        loading={state.loading}
        error={state.error}
        onStartChat={onStartChat}
        onCreateAgent={() => setCreatingAgent(true)}
        onEditContact={onEditContact ?? setEditingContact}
        onConfigureContact={onConfigureContact}
        onTestConnection={(contact) => void testConnection(contact)}
        testingContactId={testingId}
      />
      <InlineAgentEditorModal
        contact={editingContact}
        fetchImpl={fetchImpl}
        isOpen={editingContact !== undefined}
        onOpenChange={(open) => { if (!open) setEditingContact(undefined); }}
        onSaved={(contact) => {
          updateContact(contact);
          setEditingContact(undefined);
        }}
      />
      <NewAgentEditorModal
        fetchImpl={fetchImpl}
        isOpen={creatingAgent}
        onOpenChange={setCreatingAgent}
        onSaved={(contact) => {
          setState((current) => ({ ...current, items: upsertContact(current.items, contact) }));
          setCreatingAgent(false);
        }}
      />
    </>
  );
}

export function ArtifactsRailContainer({ fetchImpl, onReferenceArtifact }: { readonly fetchImpl: typeof fetch; readonly onReferenceArtifact?: ((reference: ArtifactChatReference) => void) | undefined }) {
  const [state, setState] = useState<RailViewState<ArtifactLibraryItem>>({ items: [], loading: true });
  const [preview, setPreview] = useState<ArtifactPreviewState | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void fetchImpl("/artifacts", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(`artifacts ${response.status}`);
        return normalizeArtifactLibrary(payload);
      })
      .then((artifacts) => {
        if (!cancelled) setState({ items: artifacts, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ items: [], loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  const openArtifact = async (artifact: ArtifactLibraryItem) => {
    const request = artifactFilePreviewRequestForLibrary(artifact);
    setPreview({ item: artifact, loading: true });
    try {
      const response = await fetchImpl(request.contentPath, { credentials: "same-origin", headers: { accept: "application/json, text/plain;q=0.8" } });
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      setPreview({ item: artifact, content: await readArtifactFilePreviewContent(response) });
    } catch (error) {
      setPreview({ item: artifact, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const previewRequest = preview ? artifactFilePreviewRequestForLibrary(preview.item) : undefined;
  return (
    <>
      <ArtifactsRailView artifacts={state.items} loading={state.loading} error={state.error} onOpenArtifact={(artifact) => void openArtifact(artifact)} />
      {preview && previewRequest ? (
        <ArtifactPreviewModal
          isOpen
          artifactId={preview.item.id}
          artifactKind={preview.item.kind}
          kind={preview.item.kind}
          type="file"
          name={previewRequest.name}
          mimeType={preview.item.mimeType}
          sizeBytes={preview.item.sizeBytes}
          previewKind={normalizePreviewKind(undefined, preview.item.mimeType, previewRequest.name)}
          content={preview.content}
          error={preview.error}
          loading={preview.loading}
          downloadUrl={previewRequest.rawUrl}
          onReferenceInChat={onReferenceArtifact}
          onRetry={() => void openArtifact(preview.item)}
          onOpenChange={(open) => { if (!open) setPreview(undefined); }}
        />
      ) : null}
    </>
  );
}

export function ContactsRailView({ contacts, loading, error, onStartChat, onCreateAgent, onEditContact, onTestConnection, testingContactId }: { readonly contacts: readonly AgentContactViewModel[]; readonly loading: boolean; readonly error?: string | undefined; readonly onStartChat?: ((contact: AgentContactViewModel) => void) | undefined; readonly onCreateAgent?: (() => void) | undefined; readonly onEditContact?: ((contact: AgentContactViewModel) => void) | undefined; readonly onConfigureContact?: ((contact: AgentContactViewModel) => void) | undefined; readonly onTestConnection?: ((contact: AgentContactViewModel) => void) | undefined; readonly testingContactId?: string | undefined }) {
  const sorted = useMemo(() => [...contacts].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.displayName.localeCompare(b.displayName)), [contacts]);
  return (
    <RailSurface title="Agent 联系人" subtitle={`${sorted.length} 个联系人`} loading={loading} error={error}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-3">
        <div>
          <h2 className="text-sm font-semibold">联系人目录</h2>
          <p className="mt-1 text-xs text-muted">从可运行的 agent 联系人创建或开始聊天。</p>
        </div>
        <Button size="sm" variant="primary" onPress={() => onCreateAgent?.()} data-testid="contacts-new-agent">
          新建 Agent
        </Button>
      </div>
      {sorted.length === 0 && !loading ? <p className="text-sm text-muted">暂无可用联系人。</p> : null}
      <div className="grid gap-3">
        {sorted.map((contact) => (
          <Card key={contact.agentBindingId} variant="default" className="border border-border">
            <Card.Content className="p-4">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar size="md">
                  {contact.avatarUrl ? <img className="h-full w-full object-cover" src={contact.avatarUrl} alt="" /> : null}
                  <Avatar.Fallback>{initials(contact.displayName)}</Avatar.Fallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{contact.displayName}</h2>
                    <Chip size="sm" variant="soft" color={contactStatusColor(contact.status)}>{contactStatusLabel(contact.status)}</Chip>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{contact.roleName ?? contact.roleId} / {contact.runtimeName ?? contact.runtimeKind}</p>
                  <RuntimeHealthMessage contact={contact} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip size="sm" variant="soft" color="accent">{contact.runtimeName ?? contact.runtimeKind}</Chip>
                    <RuntimeHealthBadge contact={contact} />
                    {contact.modelName ? <Chip size="sm" variant="soft" color="default">{contact.modelName}</Chip> : null}
                    {(contact.skills ?? []).slice(0, 2).map((skill) => (
                      <Chip key={skill} size="sm" variant="soft" color="default">{skill}</Chip>
                    ))}
                  </div>
                  {contact.description ? <p className="mt-2 line-clamp-2 text-sm text-muted">{contact.description}</p> : null}
                  {contact.systemPrompt ? <p className="mt-2 line-clamp-2 text-xs text-muted">{contact.systemPrompt}</p> : null}
                  {contact.runtimeId ? <p className="mt-2 ah-mono text-[11px] text-muted">{contact.runtimeId}</p> : null}
                  {contact.capabilities.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {contact.capabilities.slice(0, 3).map((capability) => (
                        <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
                      ))}
                      {contact.capabilities.length > 3 ? <Chip size="sm" variant="soft" color="default">+{contact.capabilities.length - 3} 更多</Chip> : null}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onPress={() => onStartChat?.(contact)}>开始聊天</Button>
                    <Button size="sm" variant="secondary" onPress={() => onEditContact?.(contact)}>编辑 / 配置</Button>
                    <Button size="sm" variant="tertiary" isPending={testingContactId === contact.agentBindingId} isDisabled={testingContactId !== undefined} onPress={() => onTestConnection?.(contact)}>测试连接</Button>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>
        ))}
      </div>
    </RailSurface>
  );
}

export function ArtifactsRailView({ artifacts, loading, error, onOpenArtifact }: { readonly artifacts: readonly ArtifactLibraryItem[]; readonly loading: boolean; readonly error?: string | undefined; readonly onOpenArtifact?: ((artifact: ArtifactLibraryItem) => void) | undefined }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const kindOptions = useMemo(() => ["all", ...uniqueOptionValues(artifacts.map((artifact) => artifact.kind))], [artifacts]);
  const sorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...artifacts]
      .filter((artifact) => kind === "all" || artifact.kind === kind)
      .filter((artifact) => {
        if (normalizedQuery.length === 0) return true;
        return [artifact.title, artifact.filename, artifact.kind, artifact.createdBy, artifact.roomId]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title));
  }, [artifacts, kind, query]);
  return (
    <RailSurface title="产物库" subtitle={`${sorted.length} 个产物`} loading={loading} error={error}>
      <div className="grid gap-3 rounded-lg border border-border bg-surface px-3 py-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <TextField value={query} onChange={setQuery}>
          <Label className="text-xs font-semibold uppercase text-muted">搜索产物</Label>
          <Input placeholder="按标题、文件名、房间或作者搜索" />
        </TextField>
        <Select
          aria-label="类型筛选"
          selectedKey={kind}
          placeholder="全部类型"
          variant="secondary"
          onSelectionChange={(key: unknown) => setKind(selectValue(key) || "all")}
        >
          <Label className="text-xs font-semibold uppercase text-muted">类型筛选</Label>
          <Select.Trigger className="min-h-10 bg-field-background">
            <Select.Value>
              <span className="truncate font-semibold">{kind === "all" ? "全部类型" : kind}</span>
            </Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="max-h-72">
            <ListBox aria-label="产物类型筛选">
              {kindOptions.map((option) => (
                <ListBox.Item key={option} id={option} textValue={option}>
                  <div className="flex min-w-0 items-center justify-between gap-3 py-1">
                    <span className="truncate">{option === "all" ? "全部类型" : option}</span>
                    <ListBox.ItemIndicator />
                  </div>
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">最近产物</h2>
        <Chip size="sm" variant="soft" color="default">显示 {sorted.length} 个</Chip>
      </div>
      {sorted.length === 0 && !loading ? <p className="text-sm text-muted">尚未发布任何产物。</p> : null}
      <div className="grid gap-3">
        {sorted.map((artifact) => (
          <Card key={artifact.id} variant="default" className="border border-border">
            <Card.Header className="gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <Card.Title className="min-w-0 flex-1 truncate text-sm">{artifact.title}</Card.Title>
                <Chip size="sm" variant="soft" color="accent">{artifact.kind}</Chip>
                {artifact.latestVersion !== undefined ? <Chip size="sm" variant="soft" color="default">v{artifact.latestVersion}</Chip> : null}
              </div>
              <Card.Description className="truncate text-xs">{artifact.filename ?? artifact.id}</Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-2 px-4 pb-4 text-xs text-muted">
              <div className="flex flex-wrap gap-1.5">
                {artifact.mimeType ? <Chip size="sm" variant="soft" color="default">{artifact.mimeType}</Chip> : null}
                {artifact.sizeBytes !== undefined ? <Chip size="sm" variant="soft" color="default">{formatBytes(artifact.sizeBytes)}</Chip> : null}
                {artifact.createdBy ? <Chip size="sm" variant="soft" color="default">{artifact.createdBy}</Chip> : null}
              </div>
              {artifact.roomId ? <span className="ah-mono truncate">{artifact.roomId}</span> : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onPress={() => onOpenArtifact?.(artifact)} data-artifact-id={artifact.id}>打开预览</Button>
              </div>
            </Card.Content>
          </Card>
        ))}
      </div>
    </RailSurface>
  );
}

export function RunsRailView() {
  return (
    <RailSurface title="运行" subtitle="实时和最近的 agent 活动" loading={false}>
      <Card variant="default" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">运行活动</Card.Title>
            <Chip size="sm" variant="soft" color="warning">实时</Chip>
          </div>
          <Card.Description className="text-xs">从聊天中打开运行，可查看转录、工具、产物和成本。</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-2 text-sm text-muted">
          <p>从任意房间打开一次运行详情后，这里会保留最近活动，方便继续查看转录、工具和产物。</p>
          <p className="text-xs">正在运行的 Agent 会在聊天底部实时显示状态。</p>
        </Card.Content>
      </Card>
    </RailSurface>
  );
}

export function TasksRailView() {
  return (
    <RailSurface title="任务" subtitle="聚焦的任务工作台" loading={false}>
      <Card variant="default" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">任务工作台</Card.Title>
            <Chip size="sm" variant="soft" color="accent">看板</Chip>
          </div>
          <Card.Description className="text-xs">查看阻塞、委托工作、交付证明和待审查变更。</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-2 text-sm text-muted">
          <p>打开房间侧栏即可查看任务看板、委派链路和交付证明。</p>
          <p className="text-xs">任务状态会随房间活动自动更新，无需刷新页面。</p>
        </Card.Content>
      </Card>
    </RailSurface>
  );
}

export function normalizeAgentContacts(payload: unknown): AgentContactViewModel[] {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { readonly contacts?: unknown }).contacts)
    ? (payload as { readonly contacts: unknown[] }).contacts
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const agentBindingId = stringField(record.agentBindingId ?? record.agent_binding_id);
    const displayName = stringField(record.displayName ?? record.display_name);
    const roleId = stringField(record.roleId ?? record.role_id);
    const runtimeId = stringField(record.runtimeId ?? record.runtime_id);
    const modelConfigId = stringField(record.modelConfigId ?? record.model_config_id);
    const roleName = stringField(record.roleName ?? record.role_name ?? record.role);
    const runtimeKind = stringField(record.runtimeKind ?? record.runtime_kind);
    const runtimeName = stringField(record.runtimeName ?? record.runtime_name ?? record.runtime);
    const modelName = stringField(record.modelName ?? record.model_name);
    const status = contactStatus(record.status);
    if (!agentBindingId || !displayName || !roleId || !runtimeKind || !status) return [];
    const avatarUrl = stringField(record.avatarUrl ?? record.avatar_url);
    const description = stringField(record.description ?? record.contactDescription ?? record.contact_description);
    const systemPrompt = stringField(record.systemPrompt ?? record.system_prompt ?? record.prompt);
    const runtimeHealth = runtimeHealthField(record.runtimeHealth ?? record.runtime_health);
    const lastUsedAt = numberField(record.lastUsedAt ?? record.last_used_at);
    return [{
      agentBindingId,
      displayName,
      roleId,
      ...(runtimeId !== undefined ? { runtimeId } : {}),
      ...(modelConfigId !== undefined ? { modelConfigId } : {}),
      ...(roleName !== undefined ? { roleName } : {}),
      runtimeKind,
      ...(runtimeName !== undefined ? { runtimeName } : {}),
      ...(modelName !== undefined ? { modelName } : {}),
      capabilities: stringArray(record.capabilities),
      skills: stringArray(record.skills),
      status,
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(runtimeHealth !== undefined ? { runtimeHealth } : {}),
      ...(lastUsedAt !== undefined ? { lastUsedAt } : {})
    }];
  });
}

export function normalizeArtifactLibrary(payload: unknown): ArtifactLibraryItem[] {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { readonly artifacts?: unknown }).artifacts)
    ? (payload as { readonly artifacts: unknown[] }).artifacts
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = stringField(record.id);
    const kind = stringField(record.kind) ?? stringField(record.type);
    const title = stringField(record.title) ?? stringField(record.filename);
    if (!id || !kind || !title) return [];
    const filename = stringField(record.filename);
    const latestVersion = numberField(record.latestVersion ?? record.latest_version ?? record.version);
    const roomId = stringField(record.roomId ?? record.room_id);
    const createdBy = stringField(record.createdBy ?? record.created_by);
    const mimeType = stringField(record.mimeType ?? record.mime_type);
    const sizeBytes = numberField(record.sizeBytes ?? record.size_bytes);
    const updatedAt = numberField(record.updatedAt ?? record.updated_at ?? record.createdAt ?? record.created_at);
    const filePath = stringField(record.filePath ?? record.file_path ?? record.path ?? record.filename);
    return [{
      id,
      kind,
      title,
      ...(filename !== undefined ? { filename } : {}),
      ...(latestVersion !== undefined ? { latestVersion } : {}),
      ...(roomId !== undefined ? { roomId } : {}),
      ...(createdBy !== undefined ? { createdBy } : {}),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(filePath !== undefined ? { filePath } : {})
    }];
  });
}

export function artifactFilePreviewRequestForLibrary(artifact: ArtifactLibraryItem): { readonly contentPath: string; readonly rawUrl: string; readonly name: string } {
  const path = artifact.filePath ?? artifact.filename ?? "index.html";
  const contentPath = `/artifacts/${encodeURIComponent(artifact.id)}/files/${encodeURIComponent(path)}`;
  return {
    contentPath,
    rawUrl: `${contentPath}/raw`,
    name: path
  };
}

export async function readArtifactFilePreviewContent(response: Response): Promise<string> {
  const text = await response.text();
  const payload = parseJson(text);
  if (isRecord(payload)) {
    const envelopeContent = payload.content;
    if (typeof envelopeContent === "string") return envelopeContent;
    if (isRecord(envelopeContent)) {
      if (typeof envelopeContent.content === "string") return envelopeContent.content;
      if (typeof envelopeContent.newContent === "string") return envelopeContent.newContent;
      if (typeof envelopeContent.oldContent === "string") return envelopeContent.oldContent;
      const file = envelopeContent.file;
      if (isRecord(file)) {
        if (typeof file.newContent === "string") return file.newContent;
        if (typeof file.oldContent === "string") return file.oldContent;
      }
    }
    if (typeof payload.newContent === "string") return payload.newContent;
    if (typeof payload.oldContent === "string") return payload.oldContent;
  }
  return text;
}

function RailSurface({ title, subtitle, loading, error, children }: { readonly title: string; readonly subtitle: string; readonly loading: boolean; readonly error?: string | undefined; readonly children: ReactNode }) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={title}>
      <div className="shrink-0 border-b border-border bg-surface/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          {loading ? <Spinner size="sm" /> : null}
        </div>
        {error ? <Chip className="mt-3" size="sm" variant="soft" color="danger">{error}</Chip> : null}
      </div>
      <ScrollShadow className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-5xl gap-3 p-5">{children}</div>
      </ScrollShadow>
    </section>
  );
}

export async function testContactRuntimeConnection(fetchImpl: typeof fetch, runtimeId: string, runtimeKind?: string | undefined): Promise<ContactRuntimeHealth> {
  const response = await fetchImpl(`/runtimes/${encodeURIComponent(runtimeId)}/health`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({})
  });
  const payload = await response.json().catch(() => ({})) as { readonly ok?: unknown; readonly version?: unknown; readonly error?: unknown; readonly experimental?: unknown };
  const version = stringField(payload.version);
  if (isExperimentalRuntimeKind(runtimeKind) || payload.experimental === true) {
    return { status: "experimental", ...(version !== undefined ? { version } : {}) };
  }
  if (!response.ok || payload.ok === false) {
    return { status: "error", error: stringField(payload.error) ?? `Runtime health failed: HTTP ${response.status}` };
  }
  return { status: "success", ...(version !== undefined ? { version } : {}) };
}

export function runtimeHealthBadgeForContact(contact: AgentContactViewModel): ContactRuntimeHealth | undefined {
  if (contact.runtimeHealth !== undefined) return contact.runtimeHealth;
  if (isExperimentalRuntimeKind(contact.runtimeKind) || isExperimentalRuntimeKind(contact.runtimeName) || isExperimentalRuntimeKind(contact.runtimeId)) return { status: "experimental" };
  return undefined;
}

export function normalizeRuntimeOptions(payload: unknown): RuntimeOption[] {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { readonly runtimes?: unknown }).runtimes)
    ? (payload as { readonly runtimes: unknown[] }).runtimes
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = stringField(record.id);
    const kind = stringField(record.kind);
    const name = stringField(record.name);
    if (!id || !kind || !name) return [];
    const version = stringField(record.detectedVersion ?? record.detected_version ?? record.version);
    const status = stringField(record.status);
    return [{
      id,
      kind,
      name,
      ...(version !== undefined ? { version } : {}),
      ...(status !== undefined ? { status } : {})
    }];
  });
}

function RuntimeHealthBadge({ contact }: { readonly contact: AgentContactViewModel }) {
  const health = runtimeHealthBadgeForContact(contact);
  if (health === undefined) return null;
  const color = health.status === "success" ? "success" : health.status === "experimental" ? "warning" : "danger";
  return <Chip size="sm" variant="soft" color={color}>{runtimeHealthLabel(health)}</Chip>;
}

function RuntimeHealthMessage({ contact }: { readonly contact: AgentContactViewModel }) {
  const health = runtimeHealthBadgeForContact(contact);
  if (health === undefined) return null;
  if (health.status === "success") return <p className="mt-2 text-xs text-success">连接可用{health.version ? ` (${health.version})` : ""}</p>;
  if (health.status === "experimental") return <p className="mt-2 text-xs text-warning">实验性{health.version ? ` (${health.version})` : ""}</p>;
  return <p className="mt-2 text-xs text-danger">连接失败{health.error ? `: ${health.error}` : ""}</p>;
}

function runtimeHealthLabel(health: ContactRuntimeHealth): string {
  if (health.status === "success") return health.version ? `可用 ${health.version}` : "可用";
  if (health.status === "experimental") return health.version ? `实验性 ${health.version}` : "实验性";
  return "失败";
}

function NewAgentEditorModal({ fetchImpl, isOpen, onOpenChange, onSaved }: { readonly fetchImpl: typeof fetch; readonly isOpen: boolean; readonly onOpenChange: (open: boolean) => void; readonly onSaved: (contact: AgentContactViewModel) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeOption[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setRuntimeId("");
      setRuntimes([]);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setLoadingRuntimes(true);
    setError(undefined);
    void fetchImpl("/runtimes", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(`runtimes ${response.status}`);
        return normalizeRuntimeOptions(payload);
      })
      .then((options) => {
        if (cancelled) return;
        setRuntimes(options);
        setRuntimeId((current) => current || preferredRuntimeId(options));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadingRuntimes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl, isOpen]);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId);
  const canSave = name.trim().length > 0 && systemPrompt.trim().length > 0 && runtimeId.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await createNewAgentContact(fetchImpl, {
        name: name.trim(),
        runtimeId,
        runtimeKind: selectedRuntime?.kind,
        runtimeName: selectedRuntime?.name,
        description: description.trim(),
        systemPrompt: systemPrompt.trim()
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg" className="items-center justify-center p-4">
        <Modal.Dialog aria-label="新建 agent" className="max-h-[88vh] overflow-hidden p-0">
          <Modal.CloseTrigger aria-label="关闭新建 agent 编辑器" />
          <Modal.Header className="border-b border-border px-5 py-4">
            <div>
              <Modal.Heading>新建 Agent</Modal.Heading>
              <p className="mt-1 text-sm text-muted">创建一个由联系人驱动的自定义 agent，用于聊天。</p>
            </div>
          </Modal.Header>
          <Modal.Body className="grid gap-4 overflow-auto p-5">
            <TextField value={name} onChange={setName}>
              <Label className="text-sm font-semibold">显示名称</Label>
              <Input placeholder="Launch Builder" />
            </TextField>
            <Select
              aria-label="Runtime"
              selectedKey={runtimeId}
              placeholder={loadingRuntimes ? "正在加载运行时" : "选择运行时"}
              variant="secondary"
              isDisabled={loadingRuntimes || runtimes.length === 0}
              onSelectionChange={(key: unknown) => setRuntimeId(selectValue(key))}
            >
              <Label className="text-sm font-semibold">运行时</Label>
              <Select.Trigger className="min-h-10 bg-field-background" data-testid="new-agent-runtime">
                <Select.Value>
                  <span className="truncate font-semibold">{selectedRuntime?.name ?? (loadingRuntimes ? "正在加载运行时" : "选择运行时")}</span>
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="max-h-72">
                <ListBox aria-label="Runtime">
                  {runtimes.map((runtime) => (
                    <ListBox.Item key={runtime.id} id={runtime.id} textValue={runtime.name}>
                      <div className="flex min-w-0 items-center justify-between gap-3 py-1">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{runtime.name}</span>
                          <span className="block truncate text-xs text-muted">{runtime.kind}{runtime.version ? ` / ${runtime.version}` : ""}</span>
                        </span>
                        <ListBox.ItemIndicator />
                      </div>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <TextField value={description} onChange={setDescription}>
              <Label className="text-sm font-semibold">描述</Label>
              <TextArea className="min-h-24" placeholder="这个 agent 擅长什么" />
            </TextField>
            <TextField value={systemPrompt} onChange={setSystemPrompt}>
              <Label className="text-sm font-semibold">系统提示词</Label>
              <TextArea className="min-h-32 ah-mono" placeholder="Agent 行为和边界" />
            </TextField>
            {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer className="border-t border-border px-5 py-4">
            <Button size="sm" variant="secondary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" variant="primary" isPending={saving} isDisabled={!canSave} onPress={() => void save()}>保存</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function InlineAgentEditorModal({ contact, fetchImpl, isOpen, onOpenChange, onSaved }: { readonly contact: AgentContactViewModel | undefined; readonly fetchImpl: typeof fetch; readonly isOpen: boolean; readonly onOpenChange: (open: boolean) => void; readonly onSaved: (contact: AgentContactViewModel) => void }) {
  const [name, setName] = useState(contact?.displayName ?? "");
  const [description, setDescription] = useState(contact?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(contact?.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setName(contact?.displayName ?? "");
    setDescription(contact?.description ?? "");
    setSystemPrompt(contact?.systemPrompt ?? "");
    setError(undefined);
  }, [contact]);

  const save = async () => {
    if (contact === undefined || name.trim().length === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await saveAgentContact(fetchImpl, contact, {
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim()
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg" className="items-center justify-center p-4">
        <Modal.Dialog aria-label="编辑 agent 联系人" className="max-h-[88vh] overflow-hidden p-0">
          <Modal.CloseTrigger aria-label="关闭 agent 编辑器" />
          <Modal.Header className="border-b border-border px-5 py-4">
            <div>
              <Modal.Heading>Agent 联系人编辑器</Modal.Heading>
              <p className="mt-1 text-sm text-muted">编辑 / 配置 {contact?.displayName ?? "agent 联系人"}</p>
            </div>
          </Modal.Header>
          <Modal.Body className="grid gap-4 overflow-auto p-5">
            <TextField value={name} onChange={setName}>
              <Label className="text-sm font-semibold">显示名称</Label>
              <Input placeholder="Agent 显示名称" />
            </TextField>
            <TextField value={description} onChange={setDescription}>
              <Label className="text-sm font-semibold">描述</Label>
              <TextArea className="min-h-24" placeholder="这个联系人擅长什么" />
            </TextField>
            <TextField value={systemPrompt} onChange={setSystemPrompt}>
              <Label className="text-sm font-semibold">系统提示词</Label>
              <TextArea className="min-h-32 ah-mono" placeholder="Agent 行为和边界" />
            </TextField>
            <div className="grid gap-2 rounded-lg border border-border bg-surface-secondary p-3 text-xs text-muted">
              <span>角色：{contact?.roleName ?? contact?.roleId ?? "角色"}</span>
              <span>运行时：{contact?.runtimeName ?? contact?.runtimeKind ?? "运行时"}</span>
              {contact?.modelName ? <span>模型：{contact.modelName}</span> : null}
              {contact?.runtimeId ? <span className="ah-mono">{contact.runtimeId}</span> : null}
            </div>
            {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer className="border-t border-border px-5 py-4">
            <Button size="sm" variant="secondary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" variant="primary" isPending={saving} isDisabled={name.trim().length === 0} onPress={() => void save()}>保存</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export async function createNewAgentContact(fetchImpl: typeof fetch, draft: NewAgentDraft): Promise<AgentContactViewModel> {
  const response = await fetchImpl("/agents/custom", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      name: draft.name,
      runtimeId: draft.runtimeId,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      capabilities: ["chat"]
    })
  });
  const payload = await response.json().catch(() => ({})) as { readonly agentBindingId?: unknown; readonly roleId?: unknown };
  if (!response.ok) throw new Error(responseErrorMessage(payload, `agent create failed: HTTP ${response.status}`));
  const agentBindingId = stringField(payload.agentBindingId);
  const contactsResponse = await fetchImpl("/agents/contacts", { credentials: "same-origin", headers: { accept: "application/json" } });
  const contactsPayload = await contactsResponse.json().catch(() => ({})) as unknown;
  if (!contactsResponse.ok) throw new Error(responseErrorMessage(contactsPayload, `contacts refresh failed: HTTP ${contactsResponse.status}`));
  const contacts = normalizeAgentContacts(contactsPayload);
  const created = contacts.find((contact) => contact.agentBindingId === agentBindingId)
    ?? contacts.find((contact) => contact.displayName === draft.name);
  if (created !== undefined) return created;
  return {
    agentBindingId: agentBindingId ?? draft.name,
    displayName: draft.name,
    roleId: stringField(payload.roleId) ?? agentBindingId ?? draft.name,
    runtimeId: draft.runtimeId,
    runtimeKind: draft.runtimeKind ?? "custom-acp",
    ...(draft.runtimeName !== undefined ? { runtimeName: draft.runtimeName } : {}),
    capabilities: ["chat"],
    status: "available",
    ...(draft.description.length > 0 ? { description: draft.description } : {}),
    systemPrompt: draft.systemPrompt
  };
}

async function saveAgentContact(fetchImpl: typeof fetch, contact: AgentContactViewModel, input: { readonly name: string; readonly description: string; readonly systemPrompt: string }): Promise<AgentContactViewModel> {
  const response = await fetchImpl(`/agents/contacts/${encodeURIComponent(contact.agentBindingId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) throw new Error(responseErrorMessage(payload, `contact save failed: HTTP ${response.status}`));
  const normalized = normalizeAgentContacts(payload);
  return normalized[0] ?? {
    ...contact,
    displayName: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt
  };
}

function upsertContact(current: readonly AgentContactViewModel[], contact: AgentContactViewModel): AgentContactViewModel[] {
  if (current.some((item) => item.agentBindingId === contact.agentBindingId)) {
    return current.map((item) => item.agentBindingId === contact.agentBindingId ? { ...item, ...contact } : item);
  }
  return [contact, ...current];
}

function preferredRuntimeId(runtimes: readonly RuntimeOption[]): string {
  return runtimes.find((runtime) => !isExperimentalRuntimeKind(runtime.kind))?.id ?? runtimes[0]?.id ?? "";
}

function responseErrorMessage(payload: unknown, fallback: string): string {
  return payload && typeof payload === "object" && typeof (payload as { readonly error?: unknown }).error === "string"
    ? (payload as { readonly error: string }).error
    : fallback;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function runtimeHealthField(value: unknown): ContactRuntimeHealth | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "success" && status !== "error" && status !== "experimental") return undefined;
  const version = stringField(record.version);
  const error = stringField(record.error);
  return {
    status,
    ...(version !== undefined ? { version } : {}),
    ...(error !== undefined ? { error } : {})
  };
}

function contactStatus(value: unknown): AgentContactViewModel["status"] | undefined {
  return value === "available" || value === "busy" || value === "offline" ? value : undefined;
}

function selectValue(key: unknown): string {
  if (typeof key === "string") return key;
  if (key instanceof Set) return String(Array.from(key)[0] ?? "");
  return "";
}

function uniqueOptionValues(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort((a, b) => a.localeCompare(b));
}

function contactStatusColor(status: AgentContactViewModel["status"]): "success" | "warning" | "default" {
  if (status === "available") return "success";
  if (status === "busy") return "warning";
  return "default";
}

function contactStatusLabel(status: AgentContactViewModel["status"]): string {
  if (status === "available") return "在线";
  if (status === "busy") return "忙碌";
  return "离线";
}

function statusRank(status: AgentContactViewModel["status"]): number {
  if (status === "available") return 0;
  if (status === "busy") return 1;
  return 2;
}

function isExperimentalRuntimeKind(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase().includes("codex");
}

function initials(value: string): string {
  return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "A";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Number.isInteger(kb) ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
