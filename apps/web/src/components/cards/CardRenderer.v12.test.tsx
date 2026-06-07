import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardRenderer } from "./CardRenderer.tsx";

describe("V1.2 artifact cards", () => {
  it("routes document artifact payloads to DocumentCard", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-doc-1",
        kind: "document",
        title: "Launch brief.md",
        version: 3
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Document");
    expect(html).toContain("Launch brief.md");
    expect(html).toContain("v3");
    expect(html).toContain("/artifacts/artifact-doc-1/download");
  });

  it("routes web artifacts to PreviewCard with edit deploy download and expand actions", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-web-1",
        kind: "web_page",
        title: "landing.html",
        version: 1
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Preview");
    expect(html).toContain("landing.html");
    expect(html).toContain("Edit");
    expect(html).toContain("Deploy");
    expect(html).toContain("Download");
    expect(html).toContain("Expand");
    expect(html).toContain("sandbox=\"allow-scripts\"");
  });

  it("routes HTML slides and PPTX artifacts to PresentationCard branches", () => {
    const slides = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-slides-1",
        kind: "presentation",
        title: "deck.html",
        version: 2
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const pptx = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-pptx-1",
        kind: "presentation_pptx",
        title: "deck.pptx",
        version: 1
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(slides).toContain("HTML slides");
    expect(slides).toContain("Reference slide");
    expect(pptx).toContain("PPTX preview");
    expect(pptx).toContain("Install failed");
    expect(pptx).toContain("/artifacts/artifact-pptx-1/download");
  });

  it("routes deployment payloads to DeploymentCard with status actions and logs", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-1",
        artifactId: "artifact-1",
        kind: "container-build",
        provider: "agenthub-local",
        status: "failed",
        imageTag: "agenthub-artifact:v1",
        lastError: "Docker is not available",
        logs: ["Detecting providers...", "Docker missing"]
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Deployment");
    expect(html).toContain("container-build");
    expect(html).toContain("failed");
    expect(html).toContain("Docker is not available");
    expect(html).toContain("Retry");
    expect(html).toContain("View Logs");
    expect(html).toContain("Detecting providers...");
  });
});
