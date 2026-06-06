import { describe, expect, it } from "vitest";

import { artifactContentTypeFor, extensionToLanguage, isTextPreviewable, normalizePreviewKind } from "../src/preview.ts";

describe("preview contract", () => {
  it("routes mature media and document preview kinds by content type or extension", () => {
    expect(normalizePreviewKind(undefined, "application/pdf", "report.bin")).toBe("pdf");
    expect(normalizePreviewKind(undefined, undefined, "demo.mkv")).toBe("video");
    expect(normalizePreviewKind(undefined, undefined, "voice.aac")).toBe("audio");
    expect(normalizePreviewKind(undefined, undefined, "image.avif")).toBe("image");
    expect(normalizePreviewKind(undefined, "text/plain", "README.md")).toBe("markdown");
    expect(normalizePreviewKind(undefined, undefined, "Dockerfile")).toBe("text");
  });

  it("keeps frontend previewability and backend text acceptance in one contract", () => {
    expect(isTextPreviewable(undefined, "Makefile")).toBe(true);
    expect(isTextPreviewable("application/json; charset=utf-8", "payload.bin")).toBe(true);
    expect(isTextPreviewable(undefined, "archive.zip")).toBe(false);
  });

  it("maps file names to syntax language tokens", () => {
    expect(extensionToLanguage("src/app.tsx")).toBe("typescript");
    expect(extensionToLanguage("Dockerfile")).toBe("dockerfile");
    expect(extensionToLanguage("change.patch")).toBe("diff");
    expect(extensionToLanguage("notes.unknown")).toBeUndefined();
  });

  it("returns raw artifact content types from the same preview table", () => {
    expect(artifactContentTypeFor("report.md")).toBe("text/markdown; charset=utf-8");
    expect(artifactContentTypeFor("clip.ogv")).toBe("video/ogg");
    expect(artifactContentTypeFor("icon.avif")).toBe("image/avif");
    expect(artifactContentTypeFor("Makefile")).toBe("text/plain; charset=utf-8");
  });
});
