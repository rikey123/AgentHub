import type { RunViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { formatTokens, formatUsd } from "../../../lib/format.ts";

export function CostTab({ run }: { run: RunViewModel }) {
  if (!run.cost) {
    return <div className="p-6 text-center text-sm text-muted">No cost recorded yet.</div>;
  }
  const c = run.cost;
  const rows: Array<[string, string]> = [
    ["Model", c.modelId],
    ["Input tokens", formatTokens(c.inputTokens)],
    ["Output tokens", formatTokens(c.outputTokens)],
    ["Cached tokens", formatTokens(c.cachedTokens)],
    ["Cost", formatUsd(c.costUsd)]
  ];
  return (
    <div className="p-3">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title>Run cost</Card.Title>
          <Chip size="sm" variant="soft" color="default">{run.status}</Chip>
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
    </div>
  );
}
