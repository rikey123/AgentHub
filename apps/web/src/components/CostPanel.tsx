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
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase" }}>Time Window</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["today", "7d", "30d", "custom"] as TimeWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setTimeWindow(w)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                background: timeWindow === w ? "#3b82f6" : "#ffffff",
                color: timeWindow === w ? "#ffffff" : "#374151",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: timeWindow === w ? 600 : 400
              }}
              data-testid={`cost-time-${w}`}
            >
              {w === "today" ? "Today" : w === "7d" ? "7 Days" : w === "30d" ? "30 Days" : "Custom"}
            </button>
          ))}
        </div>
        {timeWindow === "custom" && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 12 }}
            />
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 12 }}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase" }}>Group By</div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["agent", "model", "day"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                background: groupBy === g ? "#3b82f6" : "#ffffff",
                color: groupBy === g ? "#ffffff" : "#374151",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: groupBy === g ? 600 : 400
              }}
              data-testid={`cost-group-${g}`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: "#6b7280", padding: "20px 0", textAlign: "center" }}>Loading...</div>}
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && data && data.groups.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px" }}>
          <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>No cost data</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>Try creating a run to generate cost data</div>
        </div>
      )}

      {!loading && !error && data && data.groups.length > 0 && (
        <>
          {/* Stacked bar chart */}
          <div style={{ marginBottom: 16, padding: "12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, paddingBottom: 20, position: "relative" }}>
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
                        background: "#3b82f6",
                        borderRadius: "4px 4px 0 0",
                        minHeight: 4,
                        opacity: 0.85
                      }}
                    />
                    <div
                      style={{
                        fontSize: 10,
                        color: "#6b7280",
                        marginTop: 4,
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
          <div style={{ marginBottom: 16 }}>
            {data.groups.map((group) => (
              <div
                key={group.key}
                onClick={() => handleRowClick(group.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  marginBottom: 6,
                  cursor: "pointer"
                }}
                data-testid={`cost-row-${group.key}`}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {group.key}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#059669" }}>${group.totalCostUsd.toFixed(4)}</span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>{group.totalTokens.toLocaleString()} tokens</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{group.runCount} runs</span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              background: "#f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Total</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#059669" }}>${data.totalCostUsd.toFixed(4)}</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>{data.totalTokens.toLocaleString()} tokens</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{data.totalRuns} runs</span>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 12, textAlign: "center" }}>
        <a
          href={`/debug/events?type=agent.run.completed`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
        >
          Open Debug Panel
        </a>
      </div>
    </div>
  );
}
