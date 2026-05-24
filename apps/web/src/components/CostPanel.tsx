import { useState, useEffect, useCallback, useMemo } from "react";
import { useCsrfFetch } from "../hooks/useSdk.ts";

type CostGroup = {
  readonly key: string;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly runCount: number;
};

type CostSummaryResponse = {
  readonly groups: readonly CostGroup[];
  readonly totalCostUsd: number;
  readonly totalRuns: number;
  readonly totalTokens: number;
};

type TimeWindow = "today" | "7d" | "30d" | "custom";

type CostPanelProps = {
  readonly workspaceId: string;
};

export function CostPanel({ workspaceId }: CostPanelProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupBy, setGroupBy] = useState<"agent" | "model" | "day">("agent");
  const [data, setData] = useState<CostSummaryResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const csrfFetch = useCsrfFetch();

  const getDateRange = useCallback((window: TimeWindow): { from: string; to: string } => {
    const now = new Date();
    const to = now.toISOString();
    let from: string;
    switch (window) {
      case "today":
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        break;
      case "7d":
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case "30d":
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case "custom":
        return { from: customFrom || to, to: customTo || to };
    }
    return { from, to };
  }, [customFrom, customTo]);

  const fetchCostSummary = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { from, to } = getDateRange(timeWindow);
      const res = await csrfFetch(
        `/workspaces/${encodeURIComponent(workspaceId)}/cost-summary?groupBy=${groupBy}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch cost summary: ${res.status}`);
      }
      const json = (await res.json()) as CostSummaryResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [csrfFetch, workspaceId, groupBy, timeWindow, getDateRange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCostSummary();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchCostSummary]);

  const maxCost = useMemo(() => {
    if (!data || data.groups.length === 0) return 0;
    return Math.max(...data.groups.map((g) => g.totalCostUsd));
  }, [data]);

  const handleRowClick = useCallback(
    (groupKey: string) => {
      // Navigate to debug panel with filter
      const url = `/debug/events?type=agent.run.completed&agentId=${encodeURIComponent(groupKey)}`;
      window.open(url, "_blank");
    },
    []
  );

  return (
    <div>
      <div style={{ marginBottom: "var(--ah-space-3)" }}>
        <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)", textTransform: "uppercase" }}>Time Window</div>
        <div style={{ display: "flex", gap: "var(--ah-space-1)", flexWrap: "wrap" }}>
          {(["today", "7d", "30d", "custom"] as TimeWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setTimeWindow(w)}
              style={{
                padding: "var(--ah-space-1) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-sm)",
                border: "1px solid var(--ah-border-strong)",
                background: timeWindow === w ? "var(--ah-accent)" : "var(--ah-bg-primary)",
                color: timeWindow === w ? "var(--ah-text-inverse)" : "var(--ah-text-secondary)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: timeWindow === w ? 600 : 400
              }}
              data-testid={`cost-time-${w}`}
              aria-pressed={timeWindow === w}
            >
              {w === "today" ? "Today" : w === "7d" ? "7 Days" : w === "30d" ? "30 Days" : "Custom"}
            </button>
          ))}
        </div>
        {timeWindow === "custom" && (
          <div style={{ display: "flex", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-2)" }}>
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ padding: "var(--ah-space-1) var(--ah-space-2)", borderRadius: "var(--ah-radius-sm)", border: "1px solid var(--ah-border-strong)", fontSize: "var(--ah-font-size-sm)" }}
              aria-label="Custom from date"
            />
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ padding: "var(--ah-space-1) var(--ah-space-2)", borderRadius: "var(--ah-radius-sm)", border: "1px solid var(--ah-border-strong)", fontSize: "var(--ah-font-size-sm)" }}
              aria-label="Custom to date"
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: "var(--ah-space-3)" }}>
        <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)", textTransform: "uppercase" }}>Group By</div>
        <div style={{ display: "flex", gap: "var(--ah-space-1)" }}>
          {(["agent", "model", "day"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              style={{
                padding: "var(--ah-space-1) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-sm)",
                border: "1px solid var(--ah-border-strong)",
                background: groupBy === g ? "var(--ah-accent)" : "var(--ah-bg-primary)",
                color: groupBy === g ? "var(--ah-text-inverse)" : "var(--ah-text-secondary)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: groupBy === g ? 600 : 400
              }}
              data-testid={`cost-group-${g}`}
              aria-pressed={groupBy === g}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)", padding: "var(--ah-space-5) 0", textAlign: "center" }}>Loading...</div>}
      {error && (
        <div style={{ background: "var(--ah-danger-light)", color: "var(--ah-text-danger)", padding: "var(--ah-space-2) var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", fontSize: "var(--ah-font-size-sm)", marginBottom: "var(--ah-space-3)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && data && data.groups.length === 0 && (
        <div style={{ textAlign: "center", padding: "var(--ah-space-7) var(--ah-space-4)" }}>
          <div style={{ fontSize: "var(--ah-font-size-base)", color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)" }}>No cost data</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Try creating a run to generate cost data</div>
        </div>
      )}

      {!loading && !error && data && data.groups.length > 0 && (
        <>
          {/* Stacked bar chart */}
          <div style={{ marginBottom: "var(--ah-space-4)", padding: "var(--ah-space-3)", background: "var(--ah-bg-elevated)", borderRadius: "var(--ah-radius-lg)", border: "1px solid var(--ah-border)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--ah-space-1)", height: 120, paddingBottom: 20, position: "relative" }}>
              {data.groups.map((group) => {
                const heightPercent = maxCost > 0 ? (group.totalCostUsd / maxCost) * 100 : 0;
                return (
                  <div
                    key={group.key}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      height: "100%",
                      cursor: "pointer"
                    }}
                    onClick={() => handleRowClick(group.key)}
                    title={`${group.key}: $${group.totalCostUsd.toFixed(4)}`}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: `${heightPercent}%`,
                        background: "var(--ah-accent)",
                        borderRadius: "var(--ah-radius-sm) var(--ah-radius-sm) 0 0",
                        minHeight: 4,
                        opacity: 0.85
                      }}
                    />
                    <div
                      style={{
                        fontSize: "var(--ah-font-size-xs)",
                        color: "var(--ah-text-muted)",
                        marginTop: "var(--ah-space-1)",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        width: "100%"
                      }}
                    >
                      {group.key.length > 8 ? group.key.slice(0, 8) + "..." : group.key}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* List */}
          <div style={{ marginBottom: "var(--ah-space-4)" }}>
            {data.groups.map((group) => (
              <div
                key={group.key}
                onClick={() => handleRowClick(group.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "var(--ah-space-2) var(--ah-space-3)",
                  borderRadius: "var(--ah-radius-md)",
                  background: "var(--ah-bg-primary)",
                  border: "1px solid var(--ah-border)",
                  marginBottom: "var(--ah-space-1)",
                  cursor: "pointer"
                }}
                data-testid={`cost-row-${group.key}`}
              >
                <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 500, color: "var(--ah-text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {group.key}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)", flexShrink: 0 }}>
                  <span style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-success)" }}>${group.totalCostUsd.toFixed(4)}</span>
                  <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{group.totalTokens.toLocaleString()} tokens</span>
                  <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{group.runCount} runs</span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div
            style={{
              padding: "var(--ah-space-3)",
              borderRadius: "var(--ah-radius-md)",
              background: "var(--ah-bg-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <span style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-secondary)" }}>Total</span>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)" }}>
              <span style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-success)" }}>${data.totalCostUsd.toFixed(4)}</span>
              <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{data.totalTokens.toLocaleString()} tokens</span>
              <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{data.totalRuns} runs</span>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: "var(--ah-space-3)", textAlign: "center" }}>
        <a
          href={`/debug/events?type=agent.run.completed`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-accent)", textDecoration: "none" }}
        >
          Open Debug Panel
        </a>
      </div>
    </div>
  );
}
