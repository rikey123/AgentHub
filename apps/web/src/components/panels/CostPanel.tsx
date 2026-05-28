import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, ListBox, Select, Skeleton, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { formatUsd } from "../../lib/format.ts";

type CostRow = {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
};

type GroupBy = "agent" | "model" | "day";
type Window = "today" | "7d" | "30d" | "custom";

function windowRange(w: Window): { from?: number; to?: number } {
  const now = Date.now();
  if (w === "today") return { from: new Date(new Date().setHours(0, 0, 0, 0)).getTime(), to: now };
  if (w === "7d") return { from: now - 7 * 86400_000, to: now };
  if (w === "30d") return { from: now - 30 * 86400_000, to: now };
  return {};
}

interface CostPanelProps {
  csrfFetch: typeof fetch;
  workspaceId?: string;
}

export function CostPanel({ csrfFetch, workspaceId = "default-workspace" }: CostPanelProps) {
  const [window, setWindow] = useState<Window>("7d");
  const [groupBy, setGroupBy] = useState<GroupBy>("agent");
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const handle = setTimeout(() => {
      const range = windowRange(window);
      const params = new URLSearchParams({ groupBy });
      if (range.from) params.set("from", String(range.from));
      if (range.to) params.set("to", String(range.to));
      setLoading(true);
      setError(undefined);
      csrfFetch(`/workspaces/${encodeURIComponent(workspaceId)}/cost-summary?${params}`)
        .then((r) => r.json())
        .then((data: { rows?: CostRow[] }) => {
          setRows(Array.isArray(data.rows) ? data.rows : []);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [window, groupBy, csrfFetch, workspaceId]);

  const total = useMemo(() => rows.reduce((acc, r) => acc + r.costUsd, 0), [rows]);
  const max = useMemo(() => Math.max(0.01, ...rows.map((r) => r.costUsd)), [rows]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title>Cost</Card.Title>
          <Card.Description>Total {formatUsd(total)}{loading ? " · loading…" : ""}</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Time Window</div>
          <ToggleButtonGroup selectionMode="single" selectedKeys={[window]} onSelectionChange={(keys: unknown) => {
            const k = Array.from(keys as Set<string>)[0];
            if (k) setWindow(k as Window);
          }}>
            <ToggleButton id="today" data-testid="cost-time-today">Today</ToggleButton>
            <ToggleButton id="7d" data-testid="cost-time-7d">7d</ToggleButton>
            <ToggleButton id="30d" data-testid="cost-time-30d">30d</ToggleButton>
          </ToggleButtonGroup>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Group By</div>
          <Select
            aria-label="Group by"
            selectedKey={groupBy}
            onSelectionChange={(k: unknown) => setGroupBy(String(k) as GroupBy)}
          >
            <Select.Trigger data-testid="cost-group-agent">
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox aria-label="Group by">
                <ListBox.Item id="agent">Group by agent</ListBox.Item>
                <ListBox.Item id="model">Group by model</ListBox.Item>
                <ListBox.Item id="day">Group by day</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </Card.Content>
      </Card>

      {error ? <Chip size="sm" color="danger" variant="soft">{error}</Chip> : null}

      {loading && rows.length === 0 ? (
        <div className="flex flex-col gap-2" aria-label="Loading cost data">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 flex-1 rounded" />
                <Skeleton className="h-3 w-16 rounded" />
              </div>
              <Skeleton className="h-1 w-full rounded" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 && !loading ? (
        <p className="px-3 py-2 text-sm text-muted">No cost data yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <Button
              key={row.bucket}
              variant="ghost"
              className="justify-start"
              onPress={() => window !== undefined && globalThis.open(`/debug/events?agentId=${encodeURIComponent(row.bucket)}`, "_blank", "noopener,noreferrer")}
            >
              <div className="flex w-full items-center gap-2">
                <span className="flex-1 truncate text-sm">{row.bucket}</span>
                <span className="ah-mono text-xs">{formatUsd(row.costUsd)}</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded bg-surface-secondary">
                <div className="h-full bg-accent" style={{ width: `${(row.costUsd / max) * 100}%` }} />
              </div>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
