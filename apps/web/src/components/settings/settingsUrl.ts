import type { SettingsTabId } from "./SettingsModal.tsx";

const VALID_SETTINGS_TABS = new Set<SettingsTabId>(["roles", "runtimes", "models", "skills", "permissions", "workspace", "deploy-providers", "mcp"]);

export function normalizeSettingsTab(value: string | null | undefined): SettingsTabId {
  return value && VALID_SETTINGS_TABS.has(value as SettingsTabId) ? (value as SettingsTabId) : "roles";
}

export function getSettingsStateFromSearch(search: string): { isOpen: boolean; tab: SettingsTabId } {
  const params = new URLSearchParams(search);
  const raw = params.get("settings");
  return raw === null ? { isOpen: false, tab: "roles" } : { isOpen: true, tab: normalizeSettingsTab(raw) };
}

export function getSettingsSearch(search: string, isOpen: boolean, tab: SettingsTabId): string {
  const params = new URLSearchParams(search);
  if (isOpen) params.set("settings", tab);
  else params.delete("settings");

  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}
