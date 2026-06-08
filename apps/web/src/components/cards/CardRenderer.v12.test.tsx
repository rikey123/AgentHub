import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deploymentActionButtonState, deploymentLogLines, loadArtifactPreviewState, loadDeploymentLogFallback } from "./ArtifactCards.tsx";
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
    expect(html).toContain("Expand Preview");
  });

  it("prefers artifact filenames over display titles in artifact card headers", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-doc-filename-1",
        kind: "document",
        title: "OpenCode Runtime Document",
        filename: "runtime-acceptance.md",
        version: 1
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("runtime-acceptance.md");
  });

  it("routes source code and generic file artifacts to generic ArtifactCard branches", () => {
    const sourceCode = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-source-1",
        kind: "source_code",
        title: "src/app.ts",
        version: 4
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const genericFile = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-file-1",
        kind: "generic_file",
        title: "dataset.csv",
        version: 1
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(sourceCode).toContain("Artifact");
    expect(sourceCode).toContain("src/app.ts");
    expect(sourceCode).toContain("source_code");
    expect(sourceCode).toContain("v4");
    expect(sourceCode).toContain("/artifacts/artifact-source-1/download");
    expect(sourceCode).toContain("Expand Preview");
    expect(sourceCode).toContain('data-testid="artifact-card"');
    expect(sourceCode).not.toContain('data-slot="card-content"><pre');

    expect(genericFile).toContain("Artifact");
    expect(genericFile).toContain("dataset.csv");
    expect(genericFile).toContain("generic_file");
    expect(genericFile).toContain("v1");
    expect(genericFile).toContain("/artifacts/artifact-file-1/download");
    expect(genericFile).toContain("Expand Preview");
    expect(genericFile).toContain('data-testid="artifact-card"');
    expect(genericFile).not.toContain('data-slot="card-content"><pre');
  });

  it("routes web artifacts to PreviewCard with the V1.2 header body footer actions", () => {
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
    expect(html).toContain("Expand Preview");
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
    expect(slides).toContain("Prev");
    expect(slides).toContain("Next");
    expect(slides).toContain("Reference Slide");
    expect(slides).toContain("Expand Preview");
    expect(pptx).toContain("PPTX preview");
    expect(pptx).toContain("Loading PPT preview");
    expect(pptx).toContain("/artifacts/artifact-pptx-1/download");
    expect(pptx).toContain("Expand Preview");
  });

  it("renders document cards with edit reference download and expand footer actions", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: "artifact-doc-2",
        kind: "document",
        title: "Research memo.md",
        version: 5
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Document");
    expect(html).toContain("Markdown summary");
    expect(html).toContain("Edit");
    expect(html).toContain("Reference");
    expect(html).toContain("Download");
    expect(html).toContain("Expand Preview");
  });

  it("covers presentation_pptx loading installing ready failed and download fallback states", () => {
    const renderPptx = (pptStatus: string) => renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "artifact",
        artifactId: `artifact-pptx-${pptStatus}`,
        kind: "presentation_pptx",
        title: `${pptStatus}.pptx`,
        version: 1,
        pptStatus,
        pptPreviewUrl: "/api/ppt-proxy/4567/"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(renderPptx("loading")).toContain("Loading PPT preview");
    expect(renderPptx("installing")).toContain("Installing officecli");
    expect(renderPptx("ready")).toContain("PPT Preview");
    expect(renderPptx("ready")).toContain("/api/ppt-proxy/4567/");
    expect(renderPptx("startFailed")).toContain("Preview start failed");
    expect(renderPptx("installFailed")).toContain("Install failed");
    for (const status of ["loading", "installing", "ready", "startFailed", "installFailed"]) {
      expect(renderPptx(status)).toContain(`/artifacts/artifact-pptx-${status}/download`);
    }
  });

  it("routes failed deployment payloads to retry/log/download actions", () => {
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
    expect(html).toContain("/deployments/deployment-1/retry");
    expect(html).toContain("View Logs");
    expect(html).toContain("/deployments/deployment-1/logs");
    expect(html).toContain("Detecting providers...");
  });

  it("renders deployment status-specific actions for running and ready cards", () => {
    const running = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-queued-1",
        artifactId: "artifact-1",
        kind: "static-site",
        provider: "agenthub-local",
        status: "in_progress",
        logs: []
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const readySite = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-ready-1",
        artifactId: "artifact-1",
        kind: "static-site",
        provider: "agenthub-local",
        status: "ready",
        url: "http://127.0.0.1:6677/sites/deployment-ready-1/",
        expiresAt: Date.now() + 30 * 60 * 1000
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const readyExport = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-export-1",
        artifactId: "artifact-1",
        kind: "container-export",
        provider: "agenthub-local",
        status: "ready",
        downloadUrl: "C:\\workspace\\.agenthub\\deployments\\deployment-export-1\\container-export.zip",
        imageTag: "agenthub-artifact:v2"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const expired = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-expired-1",
        artifactId: "artifact-1",
        kind: "preview-url",
        provider: "agenthub-local",
        status: "expired"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(running).toContain("Build");
    expect(running).toContain("Deploy");
    expect(running).toContain("Cancel");
    expect(running).toContain("/deployments/deployment-queued-1/cancel");
    expect(running).toContain("View Logs");
    expect(running).not.toContain("Unpublish");

    expect(readySite).toContain("Deployment is ready.");
    expect(readySite).toContain("Expires in");
    expect(readySite).toContain("Open Preview");
    expect(readySite).toContain("Copy URL");
    expect(readySite).toContain("Redeploy");
    expect(readySite).toContain("/deployments/deployment-ready-1/redeploy");
    expect(readySite).toContain("Unpublish");
    expect(readySite).toContain("/deployments/deployment-ready-1/unpublish");

    expect(readyExport).toContain("Ready for download");
    expect(readyExport).toContain("Download ZIP");
    expect(readyExport).toContain("/deployments/deployment-export-1/download");
    expect(readyExport).not.toContain("C:\\workspace");
    expect(readyExport).toContain("Redeploy");
    expect(readyExport).not.toContain("Unpublish");
    expect(readyExport).toContain("Copy Docker Command");
    expect(readyExport).toContain("docker run agenthub-artifact:v2");

    expect(expired).toContain("Redeploy");
    expect(expired).toContain("/deployments/deployment-expired-1/redeploy");
    expect(expired).not.toContain("Retry");
  });

  it("hides stale deployment outputs after terminal or non-ready status updates", () => {
    const expiredWithStaleUrl = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-expired-stale-1",
        artifactId: "artifact-1",
        kind: "preview-url",
        provider: "agenthub-local",
        status: "expired",
        url: "http://127.0.0.1:6677/deployments/deployment-expired-stale-1/preview"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const failedBuildWithStaleImage = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-failed-stale-1",
        artifactId: "artifact-1",
        kind: "container-build",
        provider: "agenthub-local",
        status: "failed",
        imageTag: "agenthub-artifact:failed"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));
    const runningExportWithStaleDownload = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "deployment",
        deploymentId: "deployment-running-stale-1",
        artifactId: "artifact-1",
        kind: "container-export",
        provider: "agenthub-local",
        status: "in_progress",
        downloadUrl: "C:\\workspace\\.agenthub\\deployments\\deployment-running-stale-1\\container-export.zip"
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(expiredWithStaleUrl).not.toContain("Open Preview");
    expect(expiredWithStaleUrl).not.toContain("Copy URL");
    expect(expiredWithStaleUrl).not.toContain("deployment-expired-stale-1/preview");
    expect(expiredWithStaleUrl).toContain("Redeploy");

    expect(failedBuildWithStaleImage).not.toContain("Copy Docker Command");
    expect(failedBuildWithStaleImage).not.toContain("docker run agenthub-artifact:failed");
    expect(failedBuildWithStaleImage).toContain("Retry");

    expect(runningExportWithStaleDownload).not.toContain("Download ZIP");
    expect(runningExportWithStaleDownload).not.toContain("/deployments/deployment-running-stale-1/download");
    expect(runningExportWithStaleDownload).not.toContain("C:\\workspace");
    expect(runningExportWithStaleDownload).toContain("Cancel");
  });

  it("renders every V1.2 deployment status with a visible lifecycle action", () => {
    const statuses = [
      ["queued", "Queued for deployment.", "Cancel"],
      ["in_progress", "in progress", "Cancel"],
      ["ready", "Deployment is ready.", "Redeploy"],
      ["failed", "Deployment failed", "Retry"],
      ["cancelled", "Deployment was cancelled", "Redeploy"],
      ["expired", "Preview expired", "Redeploy"],
      ["unpublished", "Deployment is unpublished", "Redeploy"]
    ] as const;

    for (const [status, bodyText, actionText] of statuses) {
      const html = renderToStaticMarkup(createElement(CardRenderer, {
        card: {
          type: "deployment",
          deploymentId: `deployment-${status}`,
          artifactId: "artifact-1",
          kind: "static-site",
          provider: "agenthub-local",
          status,
          url: status === "ready" ? "http://127.0.0.1:6678/sites/site/" : undefined
        } as never,
        csrfFetch: vi.fn<typeof fetch>()
      }));

      expect(html).toContain(status);
      expect(html).toContain(bodyText);
      expect(html).toContain(actionText);
      expect(html).toContain(`/deployments/deployment-${status}/logs`);
    }
  });

  it("deduplicates appended deployment logs before rendering REST fallback output", () => {
    expect(deploymentLogLines([
      "Detecting providers...",
      "Installing Node.js 20...",
      "Installing Node.js 20...",
      "",
      "Build complete"
    ])).toEqual([
      "Detecting providers...",
      "Installing Node.js 20...",
      "Build complete"
    ]);
  });

  it("loads deployment REST logs and merges them with live log lines", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("Installing Node.js 20...\nBuild complete\n", { status: 200 }));

    await expect(loadDeploymentLogFallback(fetchImpl, "deployment 1", ["Detecting providers...", "Installing Node.js 20..."])).resolves.toEqual([
      "Detecting providers...",
      "Installing Node.js 20...",
      "Build complete"
    ]);

    expect(fetchImpl).toHaveBeenCalledWith("/deployments/deployment%201/logs", { headers: { accept: "text/plain" } });
  });

  it("exposes deployment action button state that prevents repeated clicks", () => {
    expect(deploymentActionButtonState("retry", undefined)).toEqual({
      isPending: false,
      isDisabled: false
    });
    expect(deploymentActionButtonState("retry", "retry")).toEqual({
      isPending: true,
      isDisabled: true
    });
    expect(deploymentActionButtonState("redeploy", "retry")).toEqual({
      isPending: false,
      isDisabled: true
    });
  });

  it("ignores artifact expand loads after the modal is closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ path: "index.html" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: { content: "<h1>Hello</h1>" } }), { status: 200 }));

    await expect(loadArtifactPreviewState({
      artifactId: "artifact-web-1",
      title: "landing.html",
      csrfFetch: fetchImpl,
      shouldApply: () => false
    })).resolves.toBeUndefined();
  });
});
