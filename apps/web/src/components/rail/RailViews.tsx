import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, Button, Card, Chip, ScrollShadow, Spinner } from "@heroui/react";
import type { AgentContactViewModel } from "../../types.ts";

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
};

type RailViewState<T> = {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly error?: string | undefined;
};

export function ContactsRailContainer({ fetchImpl, onStartChat, onEditContact }: { readonly fetchImpl: typeof fetch; readonly onStartChat?: ((contact: AgentContactViewModel) => void) | undefined; readonly onEditContact?: ((contact: AgentContactViewModel) => void) | undefined }) {
  const [state, setState] = useState<RailViewState<AgentContactViewModel>>({ items: [], loading: true });

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

  return <ContactsRailView contacts={state.items} loading={state.loading} error={state.error} onStartChat={onStartChat} onEditContact={onEditContact} />;
}

export function ArtifactsRailContainer({ fetchImpl }: { readonly fetchImpl: typeof fetch }) {
  const [state, setState] = useState<RailViewState<ArtifactLibraryItem>>({ items: [], loading: true });

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

  return <ArtifactsRailView artifacts={state.items} loading={state.loading} error={state.error} />;
}

export function ContactsRailView({ contacts, loading, error, onStartChat, onEditContact }: { readonly contacts: readonly AgentContactViewModel[]; readonly loading: boolean; readonly error?: string | undefined; readonly onStartChat?: ((contact: AgentContactViewModel) => void) | undefined; readonly onEditContact?: ((contact: AgentContactViewModel) => void) | undefined }) {
  const sorted = useMemo(() => [...contacts].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.displayName.localeCompare(b.displayName)), [contacts]);
  return (
    <RailSurface title="Agent Contacts" subtitle={`${sorted.length} contact${sorted.length === 1 ? "" : "s"}`} loading={loading} error={error}>
      {sorted.length === 0 && !loading ? <p className="text-sm text-muted">No contacts are available.</p> : null}
      <div className="grid gap-3">
        {sorted.map((contact) => (
          <Card key={contact.agentBindingId} variant="default" className="border border-border">
            <Card.Content className="p-4">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar size="md">
                  <Avatar.Fallback>{initials(contact.displayName)}</Avatar.Fallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{contact.displayName}</h2>
                    <Chip size="sm" variant="soft" color={contactStatusColor(contact.status)}>{contact.status}</Chip>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{contact.roleId} / {contact.runtimeKind}</p>
                  {contact.description ? <p className="mt-2 line-clamp-2 text-sm text-muted">{contact.description}</p> : null}
                  {contact.capabilities.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {contact.capabilities.slice(0, 5).map((capability) => (
                        <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onPress={() => onStartChat?.(contact)}>Start Chat</Button>
                    <Button size="sm" variant="secondary" onPress={() => onEditContact?.(contact)}>Edit</Button>
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

export function ArtifactsRailView({ artifacts, loading, error }: { readonly artifacts: readonly ArtifactLibraryItem[]; readonly loading: boolean; readonly error?: string | undefined }) {
  const sorted = useMemo(() => [...artifacts].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title)), [artifacts]);
  return (
    <RailSurface title="Artifact Library" subtitle={`${sorted.length} artifact${sorted.length === 1 ? "" : "s"}`} loading={loading} error={error}>
      {sorted.length === 0 && !loading ? <p className="text-sm text-muted">No artifacts have been published yet.</p> : null}
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
            </Card.Content>
          </Card>
        ))}
      </div>
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
    const runtimeKind = stringField(record.runtimeKind ?? record.runtime_kind);
    const status = contactStatus(record.status);
    if (!agentBindingId || !displayName || !roleId || !runtimeKind || !status) return [];
    const avatarUrl = stringField(record.avatarUrl ?? record.avatar_url);
    const description = stringField(record.description);
    const lastUsedAt = numberField(record.lastUsedAt ?? record.last_used_at);
    return [{
      agentBindingId,
      displayName,
      roleId,
      runtimeKind,
      capabilities: stringArray(record.capabilities),
      status,
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(description !== undefined ? { description } : {}),
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
      ...(updatedAt !== undefined ? { updatedAt } : {})
    }];
  });
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

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function contactStatus(value: unknown): AgentContactViewModel["status"] | undefined {
  return value === "available" || value === "busy" || value === "offline" ? value : undefined;
}

function contactStatusColor(status: AgentContactViewModel["status"]): "success" | "warning" | "default" {
  if (status === "available") return "success";
  if (status === "busy") return "warning";
  return "default";
}

function statusRank(status: AgentContactViewModel["status"]): number {
  if (status === "available") return 0;
  if (status === "busy") return 1;
  return 2;
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
