import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactHashTarget, scrollArtifactHashTarget } from "./RunDetailDrawer.tsx";

describe("RunDetailDrawer artifact hash targeting", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "document");
  });

  it("parses artifact hash into the diff file element id", () => {
    expect(artifactHashTarget("#artifact:artifact-1:src%2Fa.ts")).toEqual({
      artifactId: "artifact-1",
      path: "src/a.ts",
      elementId: "artifact-file-artifact-1-src%2Fa.ts"
    });
  });

  it("scrolls and temporarily highlights the targeted diff file", () => {
    vi.useFakeTimers();
    const classes = new Set<string>();
    const element = {
      scrollIntoView: vi.fn(),
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name)
      }
    } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementById: (id: string) => id === "artifact-file-artifact-1-src%2Fa.ts" ? element : null
      }
    });

    const cleanup = scrollArtifactHashTarget("#artifact:artifact-1:src%2Fa.ts");

    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(element.classList.contains("ah-artifact-file-highlight")).toBe(true);

    vi.advanceTimersByTime(800);
    expect(element.classList.contains("ah-artifact-file-highlight")).toBe(false);

    cleanup();
  });
});
