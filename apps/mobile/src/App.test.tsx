import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConnectScreen, displayText } from "./App.tsx";

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

  it("repairs legacy mojibake and hides unrecoverable titles", () => {
    expect(displayText("æ¿é´ 06/10 15:06", "未命名房间")).toBe("房间 06/10 15:06");
    expect(displayText("ɾ������", "未命名房间")).toBe("未命名房间");
  });
});
