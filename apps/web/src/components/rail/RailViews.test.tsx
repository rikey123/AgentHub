import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactsRailView, ContactsRailView, normalizeArtifactLibrary, normalizeAgentContacts } from "./RailViews.tsx";

describe("rail views", () => {
  it("normalizes contacts from the daemon contact directory shape", () => {
    expect(normalizeAgentContacts({
      contacts: [{
        agentBindingId: "binding_builder",
        displayName: "Frontend Builder",
        roleId: "role_builder",
        runtimeKind: "opencode",
        capabilities: ["code.edit", "artifact.publish"],
        status: "available",
        description: "Builds UI artifacts"
      }]
    })).toEqual([{
      agentBindingId: "binding_builder",
      displayName: "Frontend Builder",
      roleId: "role_builder",
      runtimeKind: "opencode",
      capabilities: ["code.edit", "artifact.publish"],
      status: "available",
      description: "Builds UI artifacts"
    }]);
  });

  it("renders a contacts directory surface with start chat and edit actions", () => {
    const html = renderToStaticMarkup(createElement(ContactsRailView, {
      contacts: [{
        agentBindingId: "binding_builder",
        displayName: "Frontend Builder",
        roleId: "role_builder",
        runtimeKind: "opencode",
        capabilities: ["code.edit", "artifact.publish"],
        status: "available",
        description: "Builds UI artifacts"
      }],
      loading: false,
      onStartChat: () => undefined,
      onEditContact: () => undefined
    }));

    expect(html).toContain("Agent Contacts");
    expect(html).toContain("Frontend Builder");
    expect(html).toContain("opencode");
    expect(html).toContain("available");
    expect(html).toContain("code.edit");
    expect(html).toContain("Start Chat");
    expect(html).toContain("Edit");
  });

  it("normalizes artifact library rows from GET /artifacts", () => {
    expect(normalizeArtifactLibrary({
      artifacts: [{
        id: "artifact_home",
        kind: "web_page",
        title: "Landing page",
        filename: "index.html",
        latestVersion: 3,
        roomId: "room_1",
        createdBy: "Builder",
        mimeType: "text/html",
        sizeBytes: 4096,
        updatedAt: 12345
      }]
    })).toEqual([{
      id: "artifact_home",
      kind: "web_page",
      title: "Landing page",
      filename: "index.html",
      latestVersion: 3,
      roomId: "room_1",
      createdBy: "Builder",
      mimeType: "text/html",
      sizeBytes: 4096,
      updatedAt: 12345
    }]);
  });

  it("renders an artifact library surface with version and file metadata", () => {
    const html = renderToStaticMarkup(createElement(ArtifactsRailView, {
      artifacts: [{
        id: "artifact_home",
        kind: "web_page",
        title: "Landing page",
        filename: "index.html",
        latestVersion: 3,
        roomId: "room_1",
        createdBy: "Builder",
        mimeType: "text/html",
        sizeBytes: 4096,
        updatedAt: 12345
      }],
      loading: false
    }));

    expect(html).toContain("Artifact Library");
    expect(html).toContain("Landing page");
    expect(html).toContain("web_page");
    expect(html).toContain("index.html");
    expect(html).toContain("v3");
    expect(html).toContain("4 KB");
  });
});
