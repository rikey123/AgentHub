import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactHistoryList,
  ArtifactPreviewContent,
  ArtifactPreviewError,
  ArtifactRawView,
  ArtifactStudioContent,
  artifactChatReferenceForLineSelection,
  artifactChatReferenceForSlide,
  artifactPreviewTabsFor,
  artifactTextSaveRequest,
  artifactVersionDiffPath,
  artifactVersionListPath,
  artifactVersionRestorePath,
  downloadUrlForRawArtifact,
  isArtifactSaveShortcut,
  loadArtifactVersionDiff,
  loadArtifactVersions,
  normalizeArtifactVersions,
  normalizePreviewKind,
  restoreArtifactVersion,
  saveArtifactText
} from "./ArtifactPreviewModal.tsx";

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

  it("shows preview editor history raw tabs for editable text artifacts", () => {
    expect(artifactPreviewTabsFor({ type: "file", kind: "web_page", isBinary: false })).toEqual(["preview", "editor", "history", "raw"]);
  });

  it("hides editor for readonly diff terminal and binary artifacts", () => {
    expect(artifactPreviewTabsFor({ type: "diff", kind: "source_code", isBinary: false })).toEqual(["preview", "history", "raw"]);
    expect(artifactPreviewTabsFor({ type: "terminal", kind: "generic_file", isBinary: false })).toEqual(["preview", "history", "raw"]);
    expect(artifactPreviewTabsFor({ type: "file", kind: "presentation_pptx", isBinary: true })).toEqual(["preview", "history", "raw"]);
  });

  it("renders Artifact Studio tabs for editable artifacts", () => {
    const html = renderToStaticMarkup(createElement(ArtifactStudioContent, {
      name: "landing.html",
      artifactType: "file",
      artifactKind: "web_page",
      mimeType: "text/html",
      content: "<h1>Hello</h1>",
      downloadUrl: "/artifacts/artifact_1/files/landing.html/raw"
    }));

    expect(html).toContain("Artifact Studio");
    expect(html).toContain("Preview");
    expect(html).toContain("Editor");
    expect(html).toContain("History");
    expect(html).toContain("Raw");
  });

  it("renders the Artifact Studio editor panel for editable artifacts", () => {
    const html = renderToStaticMarkup(createElement(ArtifactStudioContent, {
      artifactId: "artifact_1",
      name: "landing.html",
      artifactType: "file",
      artifactKind: "web_page",
      mimeType: "text/html",
      content: "<h1>Hello</h1>",
      downloadUrl: "/artifacts/artifact_1/files/landing.html/raw",
      initialTab: "editor"
    }));

    expect(html).toContain("Monaco editor");
    expect(html).toContain("data-testid=\"artifact-monaco-editor\"");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Reference in Chat");
    expect(html).toContain("data-reference-token=\"@artifact:artifact_1#L1-L1\"");
  });

  it("hides Artifact Studio editor tab for binary PPTX artifacts", () => {
    const html = renderToStaticMarkup(createElement(ArtifactStudioContent, {
      name: "deck.pptx",
      artifactType: "file",
      artifactKind: "presentation_pptx",
      isBinary: true,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      downloadUrl: "/artifacts/artifact_2/files/deck.pptx/raw"
    }));

    expect(html).toContain("Artifact Studio");
    expect(html).toContain("Preview");
    expect(html).toContain("History");
    expect(html).toContain("Raw");
    expect(html).not.toContain("Editor");
  });

  it("renders binary metadata in Artifact Studio raw view", () => {
    const html = renderToStaticMarkup(createElement(ArtifactStudioContent, {
      name: "deck.pptx",
      artifactType: "file",
      artifactKind: "presentation_pptx",
      isBinary: true,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 1024,
      downloadUrl: "/artifacts/artifact_2/files/deck.pptx/raw",
      initialTab: "raw"
    }));

    expect(html).toContain("Binary metadata");
    expect(html).toContain("deck.pptx");
    expect(html).toContain("1.0 KB");
  });

  it("builds artifact version API requests for save history and restore", () => {
    expect(artifactVersionListPath("artifact 1")).toBe("/artifacts/artifact%201/versions");
    expect(artifactVersionDiffPath("artifact 1", 1, 2)).toBe("/artifacts/artifact%201/versions/1/diff/2");
    expect(artifactVersionRestorePath("artifact/1", 3)).toBe("/artifacts/artifact%2F1/versions/3/restore");
    expect(artifactTextSaveRequest("artifact 1", "<html />", " blue button ")).toEqual({
      path: "/artifacts/artifact%201",
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "<html />", message: "blue button" })
      }
    });
  });

  it("saves text artifacts through PATCH and restores versions through POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: { artifactId: "artifact_1", version: 2, contentEncoding: "text" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: { artifactId: "artifact_1", version: 3, contentEncoding: "text" } }), { status: 200 }));

    await expect(saveArtifactText(fetchImpl, "artifact 1", "updated", "second")).resolves.toMatchObject({ artifactId: "artifact_1", version: 2, contentEncoding: "text" });
    await expect(restoreArtifactVersion(fetchImpl, "artifact 1", 1)).resolves.toMatchObject({ artifactId: "artifact_1", version: 3, contentEncoding: "text" });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/artifacts/artifact%201", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "updated", message: "second" })
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/artifacts/artifact%201/versions/1/restore", { method: "POST" });
  });

  it("loads text version diffs through the daemon diff route", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("--- v1\n+++ v2\n@@\n-old\n+new", { status: 200 }));

    await expect(loadArtifactVersionDiff(fetchImpl, "artifact 1", 1, 2)).resolves.toContain("+new");
    expect(fetchImpl).toHaveBeenCalledWith("/artifacts/artifact%201/versions/1/diff/2");
  });

  it("recognizes Ctrl+S and Cmd+S as editor save shortcuts", () => {
    expect(isArtifactSaveShortcut({ ctrlKey: true, metaKey: false, key: "s" })).toBe(true);
    expect(isArtifactSaveShortcut({ ctrlKey: false, metaKey: true, key: "S" })).toBe(true);
    expect(isArtifactSaveShortcut({ ctrlKey: false, metaKey: false, key: "s" })).toBe(false);
    expect(isArtifactSaveShortcut({ ctrlKey: true, metaKey: false, key: "p" })).toBe(false);
  });

  it("normalizes version list payloads from the daemon route", () => {
    expect(normalizeArtifactVersions({
      versions: [
        { artifactId: "artifact_1", content_encoding: "text", created_at: 123, created_by: "agent", id: "v1", message: "initial", version: 1 },
        { artifact_id: "artifact_1", contentEncoding: "binary", createdAt: 456, createdBy: "user", metadata: { filename: "deck.pptx", sizeBytes: 1000, newSha256: "abc" }, version: 2 }
      ]
    })).toEqual([
      { artifactId: "artifact_1", contentEncoding: "text", createdAt: 123, createdBy: "agent", id: "v1", message: "initial", version: 1 },
      { artifactId: "artifact_1", contentEncoding: "binary", createdAt: 456, createdBy: "user", metadata: { filename: "deck.pptx", sizeBytes: 1000, newSha256: "abc" }, version: 2 }
    ]);
  });

  it("enriches binary history rows from the binary diff metadata endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        versions: [{ artifactId: "artifact_1", contentEncoding: "binary", createdAt: 456, createdBy: "user", version: 2 }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        type: "binary",
        from: { filename: "deck.pptx", sizeBytes: 2048, sha256: "hash2" },
        to: { filename: "deck.pptx", sizeBytes: 2048, sha256: "hash2" },
        changed: false
      }), { status: 200 }));

    await expect(loadArtifactVersions(fetchImpl, "artifact_1")).resolves.toEqual([
      { artifactId: "artifact_1", contentEncoding: "binary", createdAt: 456, createdBy: "user", metadata: { filename: "deck.pptx", sizeBytes: 2048, sha256: "hash2" }, version: 2 }
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/artifacts/artifact_1/versions/2/diff/2");
  });

  it("renders text version history rows with compare and restore affordances", () => {
    const html = renderToStaticMarkup(createElement(ArtifactHistoryList, {
      artifactId: "artifact_1",
      isBinary: false,
      onCompare: () => undefined,
      onRestore: () => undefined,
      versions: [
        { artifactId: "artifact_1", contentEncoding: "text", createdAt: 1710000000000, createdBy: "agent", message: "initial page", version: 1 }
      ]
    }));

    expect(html).toContain("v1");
    expect(html).toContain("initial page");
    expect(html).toContain("Compare");
    expect(html).toContain("Restore");
    expect(html).not.toContain("Download");
  });

  it("renders binary version history rows with restore and binary download affordances", () => {
    const html = renderToStaticMarkup(createElement(ArtifactHistoryList, {
      artifactId: "artifact_1",
      downloadUrl: "/artifacts/artifact_1/download",
      isBinary: true,
      onCompare: () => undefined,
      onRestore: () => undefined,
      versions: [
        { artifactId: "artifact_1", contentEncoding: "binary", createdAt: 1710000000000, createdBy: "agent", message: "initial deck", metadata: { filename: "deck.pptx", sizeBytes: 1024, newSha256: "abc123" }, version: 1 }
      ]
    }));

    expect(html).toContain("v1");
    expect(html).toContain("agent");
    expect(html).toContain("initial deck");
    expect(html).toContain("deck.pptx");
    expect(html).toContain("1.0 KB");
    expect(html).toContain("abc123");
    expect(html).toContain("Restore");
    expect(html).toContain("Download");
    expect(html).not.toContain("Diff");
  });

  it("renders raw text for text artifacts and metadata for binary artifacts", () => {
    const text = renderToStaticMarkup(createElement(ArtifactRawView, {
      content: "hello raw",
      downloadUrl: "/artifacts/artifact_1/download",
      isBinary: false,
      name: "index.html",
      sizeBytes: 9
    }));
    const binary = renderToStaticMarkup(createElement(ArtifactRawView, {
      downloadUrl: "/artifacts/artifact_1/download",
      isBinary: true,
      metadata: { filename: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", newSha256: "abc123", sizeBytes: 1024 },
      name: "deck.pptx",
      sizeBytes: 1024
    }));

    expect(text).toContain("hello raw");
    expect(binary).toContain("deck.pptx");
    expect(binary).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(binary).toContain("abc123");
    expect(binary).toContain("Download");
    expect(binary).not.toContain("hello raw");
  });

  it("builds structured artifact references for editor line ranges and slides", () => {
    expect(artifactChatReferenceForLineSelection("artifact_1", { startLineNumber: 12, endLineNumber: 30 })).toEqual({
      token: "@artifact:artifact_1#L12-L30",
      ref: { type: "artifact", artifactId: "artifact_1", lineStart: 12, lineEnd: 30 }
    });
    expect(artifactChatReferenceForLineSelection("artifact_1", { startLineNumber: 30, endLineNumber: 12 })).toEqual({
      token: "@artifact:artifact_1#L12-L30",
      ref: { type: "artifact", artifactId: "artifact_1", lineStart: 12, lineEnd: 30 }
    });
    expect(artifactChatReferenceForSlide("deck_1", 3)).toEqual({
      token: "@artifact:deck_1#slide=3",
      ref: { type: "artifact", artifactId: "deck_1", slide: 3 }
    });
  });
});
