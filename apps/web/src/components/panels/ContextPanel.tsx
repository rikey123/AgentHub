import { Card, Chip, Disclosure, DisclosureGroup } from "@heroui/react";
import type { ContextItemViewModel } from "../../types.ts";
import { contextStatusColor } from "../../lib/status.ts";
import { truncate } from "../../lib/format.ts";

export function ContextPanel({ items }: { items: ReadonlyArray<ContextItemViewModel> }) {
  if (items.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">暂无上下文条目。</div>;
  }
  const draft = items.filter((i) => i.status === "draft");
  const confirmed = items.filter((i) => i.status === "confirmed");
  const deprecated = items.filter((i) => i.status === "deprecated" || i.status === "disputed");

  return (
    <DisclosureGroup defaultExpandedKeys={["draft", "confirmed"]}>
      <Disclosure id="draft">
        <Disclosure.Trigger>
          <span className="flex items-center gap-2">Draft <Chip size="sm" variant="soft" color="warning">{draft.length}</Chip></span>
        </Disclosure.Trigger>
        <Disclosure.Body><ItemList items={draft} /></Disclosure.Body>
      </Disclosure>
      <Disclosure id="confirmed">
        <Disclosure.Trigger>
          <span className="flex items-center gap-2">Confirmed <Chip size="sm" variant="soft" color="success">{confirmed.length}</Chip></span>
        </Disclosure.Trigger>
        <Disclosure.Body><ItemList items={confirmed} /></Disclosure.Body>
      </Disclosure>
      <Disclosure id="deprecated">
        <Disclosure.Trigger>
          <span className="flex items-center gap-2">Deprecated <Chip size="sm" variant="soft" color="default">{deprecated.length}</Chip></span>
        </Disclosure.Trigger>
        <Disclosure.Body><ItemList items={deprecated} /></Disclosure.Body>
      </Disclosure>
    </DisclosureGroup>
  );
}

function ItemList({ items }: { items: ReadonlyArray<ContextItemViewModel> }) {
  if (items.length === 0) return <p className="px-3 py-2 text-xs text-muted">None.</p>;
  return (
    <ul className="flex flex-col gap-2 p-2">
      {items.map((item) => (
        <li key={item.id}>
          <Card variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Card.Title className="flex-1 truncate">{item.title}</Card.Title>
                <Chip size="sm" variant="soft" color={contextStatusColor(item.status)}>{item.status}</Chip>
                {item.pinned ? <Chip size="sm" variant="soft" color="accent">pinned</Chip> : null}
              </div>
              <Card.Description className="text-xs">{truncate(item.content, 120)}</Card.Description>
              <span className="text-xs text-muted">{item.scope}</span>
            </Card.Header>
          </Card>
        </li>
      ))}
    </ul>
  );
}
