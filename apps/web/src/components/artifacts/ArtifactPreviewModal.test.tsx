import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactPreviewContent, ArtifactPreviewError, downloadUrlForRawArtifact, normalizePreviewKind } from "./ArtifactPreviewModal.tsx";

describe("ArtifactPreviewContent", () => {
  it("renders sandboxed HTML previews", () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "html",
      content: "<h1>Hello</h1>",
      name: "preview.html"
    }));

    expect(html).toContain("sandbox=\"allow-scripts\"");
    expect(html).toContain("srcDoc=");
  });

  it("renders unsupported previews as download fallbacks", () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "download",
      content: undefined,
      name: "archive.zip"
    }));

    expect(html).toContain("Preview is not available");
    expect(html).toContain("archive.zip");
  });

  it("renders markdown as readable document HTML instead of raw source", () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "markdown",
      content: "# Report\n\n- Passed",
      name: "report.md"
    }));

    expect(html).toContain("<h1");
    expect(html).toContain("Report");
    expect(html).toContain("<li");
    expect(html).toContain("Passed");
  });

  it("keeps raw URLs inline unless the user explicitly downloads", () => {
    expect(downloadUrlForRawArtifact("/artifacts/a/files/image.png/raw")).toBe("/artifacts/a/files/image.png/raw?download=1");
    expect(downloadUrlForRawArtifact("/artifacts/a/files/image.png/raw?token=abc")).toBe("/artifacts/a/files/image.png/raw?token=abc&download=1");
  });

  it("routes audio and video previews from content type or extension", () => {
    expect(normalizePreviewKind(undefined, "audio/mpeg", "clip.mp3")).toBe("audio");
    expect(normalizePreviewKind(undefined, "video/mp4", "clip.mp4")).toBe("video");
    expect(normalizePreviewKind(undefined, undefined, "clip.webm")).toBe("video");
    expect(normalizePreviewKind(undefined, undefined, "clip.mkv")).toBe("video");
    expect(normalizePreviewKind(undefined, undefined, "voice.opus")).toBe("audio");
    expect(normalizePreviewKind(undefined, undefined, "icon.avif")).toBe("image");
    expect(normalizePreviewKind(undefined, undefined, "Dockerfile")).toBe("text");
  });

  it("annotates code previews with a language token from the shared preview contract", () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "code",
      content: "export const value = 1;\n",
      name: "src/app.ts"
    }));

    expect(html).toContain("data-language=\"typescript\"");
  });

  it("renders audio and video media previews", () => {
    const audio = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "audio",
      name: "clip.mp3",
      downloadUrl: "/artifacts/a/files/clip.mp3/raw"
    }));
    const video = renderToStaticMarkup(createElement(ArtifactPreviewContent, {
      previewKind: "video",
      name: "clip.mp4",
      downloadUrl: "/artifacts/a/files/clip.mp4/raw"
    }));

    expect(audio).toContain("<audio");
    expect(audio).toContain("controls");
    expect(video).toContain("<video");
    expect(video).toContain("controls");
  });

  it("renders retry action for failed modal previews", () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreviewError, { message: "Failed to load", onRetry: () => undefined }));

    expect(html).toContain("Failed to load");
    expect(html).toContain("Retry");
  });
});
