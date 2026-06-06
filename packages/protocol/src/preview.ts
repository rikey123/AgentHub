export type PreviewKind = "markdown" | "text" | "code" | "html" | "image" | "pdf" | "audio" | "video" | "download";

const textExtensions = new Set([
  "md", "markdown", "txt", "log", "diff", "patch", "csv", "tsv",
  "html", "htm", "json", "xml", "svg",
  "yml", "yaml", "toml", "ini", "conf",
  "sh", "bash", "zsh", "ps1",
  "py", "rb", "go", "rs",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "css", "scss", "sass", "less",
  "sql",
  "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp",
  "cs", "php", "lua", "vim"
]);

const codeExtensions = new Set([
  "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "cs", "cpp", "cc", "c", "h", "hpp",
  "sql", "css", "scss", "sass", "less", "json", "yaml", "yml", "toml", "xml", "sh", "bash", "zsh", "ps1",
  "rb", "kt", "swift", "php", "lua", "vim", "ini", "conf"
]);

const textContentTypes = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
  "application/x-httpd-php"
]);

const textBasenames = new Set(["dockerfile", "makefile"]);
const videoExtensions = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv"]);
const audioExtensions = new Set(["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);

const languageByExtension: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  txt: "plaintext",
  log: "plaintext",
  diff: "diff",
  patch: "diff",
  csv: "plaintext",
  tsv: "plaintext",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  vim: "vim",
  sql: "sql"
};

const languageByBasename: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile"
};

export function normalizePreviewKind(previewKind: string | undefined, contentType: string | undefined, filename: string): PreviewKind {
  if (isPreviewKind(previewKind)) return previewKind;
  const ct = normalizeContentType(contentType);
  const ext = extensionOf(filename);
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (ct.startsWith("video/") || videoExtensions.has(ext)) return "video";
  if (ct.startsWith("audio/") || audioExtensions.has(ext)) return "audio";
  if (ct.startsWith("image/") || imageExtensions.has(ext)) return "image";
  if (ct === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
  if (ct === "text/html" || ext === "html" || ext === "htm") return "html";
  if (codeExtensions.has(ext)) return "code";
  if (isTextPreviewable(contentType, filename)) return "text";
  return "download";
}

export function isPreviewable(contentType: string | undefined, filename: string): boolean {
  return normalizePreviewKind(undefined, contentType, filename) !== "download";
}

export function isTextPreviewable(contentType: string | undefined, filename: string): boolean {
  const ct = normalizeContentType(contentType);
  if (ct.startsWith("text/")) return true;
  if (textContentTypes.has(ct)) return true;
  const ext = extensionOf(filename);
  if (textExtensions.has(ext)) return true;
  return textBasenames.has(basenameOf(filename));
}

export function extensionToLanguage(filename: string): string | undefined {
  const ext = extensionOf(filename);
  if (languageByExtension[ext] !== undefined) return languageByExtension[ext];
  return languageByBasename[basenameOf(filename)];
}

export function artifactContentTypeFor(filename: string): string {
  const ext = extensionOf(filename);
  if (ext === "md" || ext === "markdown") return "text/markdown; charset=utf-8";
  if (ext === "txt" || ext === "log" || ext === "diff" || ext === "patch") return "text/plain; charset=utf-8";
  if (ext === "csv") return "text/csv; charset=utf-8";
  if (ext === "tsv") return "text/tab-separated-values; charset=utf-8";
  if (ext === "html" || ext === "htm") return "text/html; charset=utf-8";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "text/javascript; charset=utf-8";
  if (ext === "css") return "text/css; charset=utf-8";
  if (ext === "json" || ext === "map") return "application/json; charset=utf-8";
  if (ext === "xml") return "application/xml; charset=utf-8";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "ico") return "image/x-icon";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg" || ext === "oga") return "audio/ogg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "flac") return "audio/flac";
  if (ext === "aac") return "audio/aac";
  if (ext === "opus") return "audio/opus";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "avi") return "video/x-msvideo";
  if (ext === "ogv") return "video/ogg";
  if (ext === "webmanifest") return "application/manifest+json; charset=utf-8";
  if (ext === "woff2") return "font/woff2";
  if (ext === "woff") return "font/woff";
  if (isTextPreviewable(undefined, filename)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function isPreviewKind(value: string | undefined): value is PreviewKind {
  return value === "markdown" || value === "text" || value === "code" || value === "html" || value === "image" || value === "pdf" || value === "audio" || value === "video" || value === "download";
}

function normalizeContentType(contentType: string | undefined): string {
  const ct = (contentType ?? "").toLowerCase().trim();
  const semi = ct.indexOf(";");
  return (semi >= 0 ? ct.slice(0, semi) : ct).trim();
}

function extensionOf(filename: string): string {
  const base = basenameOf(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1);
}

function basenameOf(filename: string): string {
  return (filename.toLowerCase().split(/[\\/]/u).pop() ?? "").trim();
}
