import { describe, expect, it, vi } from "vitest";
import { getSettingsSearch, getSettingsStateFromSearch, normalizeSettingsTab } from "./settingsUrl.ts";

describe("settings URL deep link contract", () => {
  it("opens the Models tab from a deep link and falls back to Roles for invalid tabs", () => {
    expect(getSettingsStateFromSearch("?settings=models")).toEqual({ isOpen: true, tab: "models" });
    expect(getSettingsStateFromSearch("?settings=skills")).toEqual({ isOpen: true, tab: "skills" });
    expect(getSettingsStateFromSearch("?settings=bogus")).toEqual({ isOpen: true, tab: "roles" });
    expect(normalizeSettingsTab("mcp")).toBe("mcp");
    expect(normalizeSettingsTab("skills")).toBe("skills");
    expect(normalizeSettingsTab("bogus")).toBe("roles");
  });

  it("removes the settings query param on close without touching other URL state", () => {
    const history = { replaceState: vi.fn() };
    const location = { pathname: "/", search: "?room=abc&settings=models", hash: "" };

    const nextSearch = getSettingsSearch(location.search, false, "models");
    history.replaceState({}, "", `${location.pathname}${nextSearch}${location.hash}`);

    expect(nextSearch).toBe("?room=abc");
    expect(history.replaceState).toHaveBeenCalledWith({}, "", "/?room=abc");
  });
});
