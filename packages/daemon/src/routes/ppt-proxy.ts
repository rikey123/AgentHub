export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const pptProxyRouteStubs = [
  { method: "GET", path: "/api/ppt-proxy", summary: "Inspect PPT preview bridge status" },
  { method: "GET", path: "/api/ppt-proxy/:port/*", summary: "Proxy a PPT preview session" }
] as const satisfies readonly RouteStub[];

export function rewritePptProxyLocation(location: string, port: number): string {
  const base = `/api/ppt-proxy/${port}`;
  try {
    const parsed = new URL(location, `http://localhost:${port}`);
    return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return location.startsWith("/") ? `${base}${location}` : `${base}/${location}`;
  }
}

export function injectPptNavigationGuard(html: string, port: number): string {
  const script = `<script>(function(){var base="/api/ppt-proxy/${port}";document.addEventListener("click",function(event){var link=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!link)return;var href=link.getAttribute("href");if(href&&href.charAt(0)==="/"&&!href.startsWith(base)){event.preventDefault();location.href=base+href;}});})();</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : `${html}${script}`;
}
