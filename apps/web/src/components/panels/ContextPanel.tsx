import { Chip } from "@heroui/react";
import type { ContextItemViewModel } from "../../types.ts";
import { contextStatusColor } from "../../lib/status.ts";
import { truncate } from "../../lib/format.ts";
import { contextScopeLabel, contextStatusLabel } from "../../lib/contextLabels.ts";

export function ContextPanel({ items }: { items: ReadonlyArray<ContextItemViewModel> }) {
  if (items.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">暂无上下文条目。</div>;
  }
  const draft = items.filter((i) => i.status === "draft");
  const confirmed = items.filter((i) => i.status === "confirmed");
  const deprecated = items.filter((i) => i.status === "deprecated" || i.status === "disputed");

  return (
    <div className="ah-context-panel">
      <ContextSection title="待确认" tone="warning" items={draft} />
      <ContextSection title="已确认" tone="success" items={confirmed} />
      <ContextSection title="已失效" tone="default" items={deprecated} />
    </div>
  );
}

function ContextSection({ title, tone, items }: { title: string; tone: "warning" | "success" | "default"; items: ReadonlyArray<ContextItemViewModel> }) {
  return (
    <section className={`ah-context-section ah-context-section-${tone}`}>
      <div className="ah-context-section-header">
        <div>
          <h3>{title}</h3>
          <p>显示 {items.length} 个</p>
        </div>
        <Chip size="sm" variant="soft" color={tone}>{items.length}</Chip>
      </div>
      <ItemList items={items} />
    </section>
  );
}

function ItemList({ items }: { items: ReadonlyArray<ContextItemViewModel> }) {
  if (items.length === 0) return <p className="ah-context-empty">暂无条目</p>;
  return (
    <ul className="ah-context-list">
      {items.map((item) => (
        <li key={item.id}>
          <article className="ah-context-item">
            <div className="ah-context-item-main">
              <div className="ah-context-item-title-row">
                <h4>{item.title}</h4>
                <div className="ah-context-item-badges">
                <Chip size="sm" variant="soft" color={contextStatusColor(item.status)}>{contextStatusLabel(item.status)}</Chip>
                {item.pinned ? <Chip size="sm" variant="soft" color="accent">已置顶</Chip> : null}
                </div>
              </div>
              <p>{truncate(item.content, 128)}</p>
              <span className="ah-context-item-scope">{contextScopeLabel(item.scope)}</span>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
