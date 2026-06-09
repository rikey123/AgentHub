import { useEffect, useState } from "react";
import type { RunViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { formatTokens, formatUsd } from "../../../lib/format.ts";
import { runStatusLabel } from "../../../lib/status.ts";

type CostGroup = {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  runCount: number;
};

interface CostTabProps {
  run: RunViewModel;
  workspaceId?: string;
  csrfFetch?: typeof fetch;
}

export function CostTab({ run, workspaceId = "default-workspace", csrfFetch }: CostTabProps) {
  const [avgUsd, setAvgUsd] = useState<number | null>(null);
  const fetcher = csrfFetch ?? globalThis.fetch.bind(globalThis);

  useEffect(() => {
    if (!run.cost || !run.agentId) {
      setAvgUsd(null);
      return;
    }
    const from = Date.now() - 7 * 86_400_000;
    const url = `/workspaces/${encodeURIComponent(workspaceId)}/cost-summary?groupBy=agent&from=${from}`;
    let cancelled = false;
    fetcher(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { groups?: CostGroup[] } | null) => {
        if (cancelled || !data) return;
        const match = (data.groups ?? []).find((g) => g.key === run.agentId);
        if (!match || match.runCount === 0 || match.costUsd === 0) {
          setAvgUsd(null);
          return;
        }
        setAvgUsd(match.costUsd / match.runCount);
      })
      .catch(() => {
        if (!cancelled) setAvgUsd(null);
      });
    return () => {
      cancelled = true;
    };
  }, [run.agentId, run.cost, workspaceId, fetcher]);

  if (!run.cost) {
    return <div className="p-6 text-center text-sm text-muted">暂无计费记录。</div>;
  }
  const c = run.cost;
  const rows: Array<[string, string]> = [
    ["model", c.modelId],
    ["输入 tokens", formatTokens(c.inputTokens)],
    ["输出 tokens", formatTokens(c.outputTokens)],
    ["缓存 tokens", formatTokens(c.cachedTokens)],
    ["费用", formatUsd(c.costUsd)]
  ];

  const showCompare = avgUsd !== null && avgUsd > 0 && c.costUsd > 0;
  const max = showCompare ? Math.max(c.costUsd, avgUsd!) : 0;
  const thisPct = showCompare ? Math.min(100, (c.costUsd / max) * 100) : 0;
  const avgPct = showCompare ? Math.min(100, (avgUsd! / max) * 100) : 0;
  const delta = showCompare ? ((c.costUsd - avgUsd!) / avgUsd!) * 100 : 0;
  const deltaSign = delta >= 0 ? "+" : "";
  const deltaColor: "success" | "warning" = delta <= 0 ? "success" : "warning";

  return (
    <div className="flex flex-col gap-3 p-3">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title>Run 计费</Card.Title>
          <Chip size="sm" variant="soft" color="default">{runStatusLabel(run.status)}</Chip>
        </Card.Header>
        <Card.Content>
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-2 text-muted">{k}</td>
                  <td className="py-1.5 ah-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card.Content>
      </Card>

      {showCompare ? (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <div className="flex items-center gap-2">
              <Card.Title className="text-sm">7 天对比</Card.Title>
              <Chip size="sm" variant="soft" color={deltaColor}>{deltaSign}{delta.toFixed(0)}%</Chip>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-2 text-xs">
              <CompareRow label="当前 Run" valueLabel={formatUsd(c.costUsd)} pct={thisPct} tone="primary" />
              <CompareRow label="同 agent 7 天均值" valueLabel={formatUsd(avgUsd!)} pct={avgPct} tone="muted" />
            </div>
          </Card.Content>
        </Card>
      ) : null}
    </div>
  );
}

function CompareRow({ label, valueLabel, pct, tone }: { label: string; valueLabel: string; pct: number; tone: "primary" | "muted" }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-muted">{label}</span>
        <span className="ah-mono">{valueLabel}</span>
      </div>
      <div className="h-2 w-full rounded bg-surface-secondary">
        <div
          className={tone === "primary" ? "h-full rounded bg-primary" : "h-full rounded bg-muted-foreground/40"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
