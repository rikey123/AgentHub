import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConnectScreen } from "./App.tsx";

describe("mobile connect screen", () => {
  it("offers direct QR scanning before manual connection fields", () => {
    const html = renderToStaticMarkup(createElement(ConnectScreen, {
      notice: null,
      onConnect: vi.fn()
    }));

    expect(html).toContain("扫码验证并连接");
    expect(html.indexOf("扫码验证并连接")).toBeLessThan(html.indexOf("身份码 / 二维码内容"));
    expect(html).toContain("导入配置");
    expect(html).toContain("手动填写");
  });
});
