import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deploymentActionButtonState, deploymentLogLines, loadArtifactPreviewState, loadDeploymentLogFallback } from "./ArtifactCards.tsx";
import { CardRenderer } from "./CardRenderer.tsx";
import { TerminalCard } from "./TerminalCard.tsx";

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

    expect(html).toContain("文档");
    expect(html).toContain("Launch brief.md");
    expect(html).toContain("v3");
    expect(html).toContain("/artifacts/artifact-doc-1/download");
    expect(html).toContain("展开预览");
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

    expect(sourceCode).toContain("产物");
    expect(sourceCode).toContain("src/app.ts");
    expect(sourceCode).toContain("source_code");
    expect(sourceCode).toContain("v4");
    expect(sourceCode).toContain("/artifacts/artifact-source-1/download");
    expect(sourceCode).toContain("展开预览");
    expect(sourceCode).toContain('data-testid="artifact-card"');
    expect(sourceCode).not.toContain('data-slot="card-content"><pre');

    expect(genericFile).toContain("产物");
    expect(genericFile).toContain("dataset.csv");
    expect(genericFile).toContain("generic_file");
    expect(genericFile).toContain("v1");
    expect(genericFile).toContain("/artifacts/artifact-file-1/download");
    expect(genericFile).toContain("展开预览");
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

    expect(html).toContain("预览");
    expect(html).toContain("landing.html");
    expect(html).toContain("编辑");
    expect(html).toContain("部署");
    expect(html).toContain("下载");
    expect(html).toContain("展开预览");
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

    expect(slides).toContain("HTML 幻灯片");
    expect(slides).toContain("上一页");
    expect(slides).toContain("下一页");
    expect(slides).toContain("引用当前页");
    expect(slides).toContain("展开预览");
    expect(pptx).toContain("PPTX 预览");
    expect(pptx).toContain("正在加载 PPT 预览");
    expect(pptx).toContain("/artifacts/artifact-pptx-1/download");
    expect(pptx).toContain("展开预览");
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

    expect(html).toContain("文档");
    expect(html).toContain("Markdown 摘要");
    expect(html).toContain("编辑");
    expect(html).toContain("引用");
    expect(html).toContain("下载");
    expect(html).toContain("展开预览");
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

    expect(renderPptx("loading")).toContain("正在加载 PPT 预览");
    expect(renderPptx("installing")).toContain("正在安装 officecli");
    expect(renderPptx("ready")).toContain("PPT 预览");
    expect(renderPptx("ready")).toContain("/api/ppt-proxy/4567/");
    expect(renderPptx("startFailed")).toContain("预览启动失败");
    expect(renderPptx("installFailed")).toContain("安装失败");
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

    expect(html).toContain("部署");
    expect(html).toContain("container-build");
    expect(html).toContain("failed");
    expect(html).toContain("Docker is not available");
    expect(html).toContain("重试");
    expect(html).toContain("/deployments/deployment-1/retry");
    expect(html).toContain("查看日志");
    expect(html).toContain("/deployments/deployment-1/logs");
    expect(html).toContain("Detecting providers...");
  });

  it("localizes diff card review actions", () => {
    const html = renderToStaticMarkup(createElement(CardRenderer, {
      card: {
        type: "diff",
        artifactId: "diff-artifact-1",
        title: "Change set",
        applyStatus: "pending",
        files: [
          { path: "src/app.ts", status: "modified", additions: 3, deletions: 1 },
          { path: "src/theme.css", status: "added", additions: 8, deletions: 0 }
        ]
      } as never,
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Diff · 2 个文件");
    expect(html).toContain("应用 Diff");
    expect(html).toContain("拒绝");
    expect(html).toContain("查看详情");
  });

  it("localizes terminal artifact card actions", () => {
    const html = renderToStaticMarkup(createElement(TerminalCard, {
      artifactId: "terminal-artifact-1",
      title: "终端",
      lines: [
        { stream: "stdout", text: "build started" },
        { stream: "stderr", text: "warning" }
      ],
      exitCode: 1
    }));

    expect(html).toContain("退出码 1");
    expect(html).toContain("2 行");
    expect(html).toContain("展开");
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

    expect(running).toContain("构建");
    expect(running).toContain("部署");
    expect(running).toContain("取消");
    expect(running).toContain("/deployments/deployment-queued-1/cancel");
    expect(running).toContain("查看日志");
    expect(running).not.toContain("下线");

    expect(readySite).toContain("部署已就绪。");
    expect(readySite).toContain("后过期");
    expect(readySite).toContain("打开预览");
    expect(readySite).toContain("复制 URL");
    expect(readySite).toContain("重新部署");
    expect(readySite).toContain("/deployments/deployment-ready-1/redeploy");
    expect(readySite).toContain("下线");
    expect(readySite).toContain("/deployments/deployment-ready-1/unpublish");

    expect(readyExport).toContain("已可下载。");
    expect(readyExport).toContain("下载 ZIP");
    expect(readyExport).toContain("/deployments/deployment-export-1/download");
    expect(readyExport).not.toContain("C:\\workspace");
    expect(readyExport).toContain("重新部署");
    expect(readyExport).not.toContain("下线");
    expect(readyExport).toContain("复制 Docker 命令");
    expect(readyExport).toContain("docker run agenthub-artifact:v2");

    expect(expired).toContain("重新部署");
    expect(expired).toContain("/deployments/deployment-expired-1/redeploy");
    expect(expired).not.toContain("重试");
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

    expect(expiredWithStaleUrl).not.toContain("打开预览");
    expect(expiredWithStaleUrl).not.toContain("复制 URL");
    expect(expiredWithStaleUrl).not.toContain("deployment-expired-stale-1/preview");
    expect(expiredWithStaleUrl).toContain("重新部署");

    expect(failedBuildWithStaleImage).not.toContain("复制 Docker 命令");
    expect(failedBuildWithStaleImage).not.toContain("docker run agenthub-artifact:failed");
    expect(failedBuildWithStaleImage).toContain("重试");

    expect(runningExportWithStaleDownload).not.toContain("下载 ZIP");
    expect(runningExportWithStaleDownload).not.toContain("/deployments/deployment-running-stale-1/download");
    expect(runningExportWithStaleDownload).not.toContain("C:\\workspace");
    expect(runningExportWithStaleDownload).toContain("取消");
  });

  it("renders every V1.2 deployment status with a visible lifecycle action", () => {
    const statuses = [
      ["queued", "已进入部署队列。", "取消"],
      ["in_progress", "正在部署。", "取消"],
      ["ready", "部署已就绪。", "重新部署"],
      ["failed", "部署失败", "重试"],
      ["cancelled", "部署已在完成前取消。", "重新部署"],
      ["expired", "预览已过期", "重新部署"],
      ["unpublished", "部署已下线。", "重新部署"]
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
