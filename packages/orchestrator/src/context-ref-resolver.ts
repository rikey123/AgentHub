import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { AgentHubDatabase } from "@agenthub/db";

const execFileAsync = promisify(execFile);

export type ContextRefResolverOptions = {
  readonly database: AgentHubDatabase;
  readonly workspaceRoot: string;
  readonly text: string;
  readonly officecliText?: (filePath: string, slide: number) => Promise<string>;
};

export async function resolveContextRefs(options: ContextRefResolverOptions): Promise<string> {
  const blocks: string[] = [];
  for (const ref of parseRefs(options.text)) {
    if (ref.type === "artifact") {
      const block = await resolveArtifactRef(options, ref);
      if (block !== undefined) blocks.push(block);
    } else {
      const block = resolveWorkspaceRef(options.workspaceRoot, ref);
      if (block !== undefined) blocks.push(block);
    }
  }
  return blocks.length > 0 ? `<context-refs>\n${blocks.join("\n")}\n</context-refs>` : "";
}

type ParsedRef =
  | { readonly type: "artifact"; readonly id: string; readonly lineStart?: number; readonly lineEnd?: number; readonly slide?: number }
  | { readonly type: "workspace"; readonly path: string; readonly lineStart?: number; readonly lineEnd?: number };

function parseRefs(text: string): ParsedRef[] {
  const refs: ParsedRef[] = [];
  const pattern = /@(artifact|workspace):([^\s#]+)(?:#(L(\d+)(?:-L(\d+))?|slide=(\d+)))?/gu;
  for (const match of text.matchAll(pattern)) {
    const type = match[1];
    const target = match[2];
    if (target === undefined) continue;
    const lineStart = match[4] !== undefined ? Number(match[4]) : undefined;
    const lineEnd = match[5] !== undefined ? Number(match[5]) : lineStart;
    const slide = match[6] !== undefined ? Number(match[6]) : undefined;
    const lineRange = lineStart !== undefined ? { lineStart, lineEnd: lineEnd ?? lineStart } : {};
    if (type === "artifact") refs.push({ type: "artifact", id: target, ...lineRange, ...(slide !== undefined ? { slide } : {}) });
    if (type === "workspace") refs.push({ type: "workspace", path: target, ...lineRange });
  }
  return refs;
}

async function resolveArtifactRef(options: ContextRefResolverOptions, ref: Extract<ParsedRef, { readonly type: "artifact" }>): Promise<string | undefined> {
  const row = options.database.sqlite.prepare("SELECT path, new_content, content_path, binary FROM artifact_files WHERE artifact_id = ? ORDER BY path ASC LIMIT 1").get(ref.id) as { readonly path: string; readonly new_content: string | null; readonly content_path: string | null; readonly binary: number } | undefined;
  if (row === undefined) return undefined;
  if (ref.slide !== undefined && row.binary === 1 && row.content_path !== null) {
    const text = await (options.officecliText ?? defaultOfficecliText)(row.content_path, ref.slide);
    return `<context-ref type="artifact" id="${xmlEscape(ref.id)}" slide="${ref.slide}" path="${xmlEscape(row.path)}">${xmlEscape(text)}</context-ref>`;
  }
  const content = row.new_content ?? "";
  const selected = selectLines(content, ref.lineStart, ref.lineEnd);
  const lines = ref.lineStart !== undefined ? ` lines="${ref.lineStart}-${ref.lineEnd ?? ref.lineStart}"` : "";
  return `<context-ref type="artifact" id="${xmlEscape(ref.id)}"${lines} path="${xmlEscape(row.path)}">${xmlEscape(selected)}</context-ref>`;
}

function resolveWorkspaceRef(workspaceRoot: string, ref: Extract<ParsedRef, { readonly type: "workspace" }>): string | undefined {
  const path = resolveWorkspacePath(workspaceRoot, ref.path);
  const content = readFileSync(path, "utf8");
  const selected = selectLines(content, ref.lineStart, ref.lineEnd);
  const lines = ref.lineStart !== undefined ? ` lines="${ref.lineStart}-${ref.lineEnd ?? ref.lineStart}"` : "";
  return `<context-ref type="workspace" path="${xmlEscape(ref.path)}"${lines}>${xmlEscape(selected)}</context-ref>`;
}

function resolveWorkspacePath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const target = isAbsolute(path) ? resolve(path) : resolve(resolvedRoot, path);
  const rel = relative(resolvedRoot, target);
  if (target !== resolvedRoot && (rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel))) throw new Error("workspace ref escapes workspace");
  return target;
}

function selectLines(content: string, start?: number, end?: number): string {
  if (start === undefined) {
    if (Buffer.byteLength(content, "utf8") <= 2_048) return content;
    return `${content.split(/\r?\n/u).slice(0, 50).join("\n")}\n(content truncated; use #Lx-Ly to reference a smaller range)`;
  }
  return content.split(/\r?\n/u).slice(Math.max(0, start - 1), end ?? start).join("\n");
}

async function defaultOfficecliText(filePath: string, slide: number): Promise<string> {
  const { stdout } = await execFileAsync("officecli", ["view", filePath, "text", "--start", String(slide), "--end", String(slide)]);
  return stdout;
}

function xmlEscape(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}
