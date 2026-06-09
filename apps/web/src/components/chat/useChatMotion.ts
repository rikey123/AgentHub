import { useMemo, useRef, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

type ChatMotionItem = {
  readonly id: string;
  readonly kind: string;
};

type ChatMotionInput = {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly items: readonly ChatMotionItem[];
  readonly selectedMessageId?: string | undefined;
  readonly activeIndicatorKey?: string | undefined;
};

export function useChatMotion({ containerRef, items, selectedMessageId, activeIndicatorKey }: ChatMotionInput): void {
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  const itemSignature = useMemo(() => items.map((item) => `${item.kind}:${item.id}`).join("|"), [items]);

  useGSAP(() => {
    const container = containerRef.current;
    if (container === null) return;

    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const nextIds = new Set(items.map((item) => item.id));
    const knownIds = knownItemIdsRef.current;

    if (knownIds.size === 0) {
      knownItemIdsRef.current = nextIds;
      return;
    }

    const incomingIds = items
      .map((item) => item.id)
      .filter((id) => !knownIds.has(id))
      .slice(-4);
    knownItemIdsRef.current = nextIds;
    if (incomingIds.length === 0) return;

    const targets = incomingIds
      .map((id) => container.querySelector<HTMLElement>(`[data-chat-feed-item-id="${cssEscape(id)}"] [data-chat-motion-target]`))
      .filter((target): target is HTMLElement => target !== null);

    if (targets.length === 0) return;
    if (reducedMotion) {
      gsap.set(targets, { clearProps: "all" });
      return;
    }

    gsap.fromTo(
      targets,
      { autoAlpha: 0, y: 18, scale: 0.985 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.34,
        ease: "power3.out",
        stagger: { each: 0.035, from: "end" },
        overwrite: "auto",
        clearProps: "transform,opacity,visibility"
      }
    );
  }, { scope: containerRef, dependencies: [itemSignature] });

  useGSAP(() => {
    const container = containerRef.current;
    if (container === null || selectedMessageId === undefined) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;

    const target = container.querySelector<HTMLElement>(`[data-message-id="${cssEscape(selectedMessageId)}"] [data-chat-bubble]`);
    if (target === null) return;

    gsap.fromTo(
      target,
      { boxShadow: "0 0 0 0 color-mix(in oklab, var(--accent) 0%, transparent)" },
      {
        boxShadow: "0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent)",
        duration: 0.18,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        overwrite: "auto",
        clearProps: "boxShadow"
      }
    );
  }, { scope: containerRef, dependencies: [selectedMessageId] });

  useGSAP(() => {
    const container = containerRef.current;
    if (container === null || activeIndicatorKey === undefined) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;

    const target = container.querySelector<HTMLElement>("[data-chat-typing-indicator]");
    if (target === null) return;

    gsap.fromTo(
      target,
      { autoAlpha: 0, y: 10 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.26,
        ease: "power2.out",
        overwrite: "auto",
        clearProps: "transform,opacity,visibility"
      }
    );
  }, { scope: containerRef, dependencies: [activeIndicatorKey] });
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
