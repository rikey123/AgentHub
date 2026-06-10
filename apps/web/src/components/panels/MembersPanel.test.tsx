import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ParticipantViewModel, TaskViewModel } from "../../types.ts";
import { MembersPanel } from "./MembersPanel.tsx";

describe("MembersPanel team management contract", () => {
  it("renders add-participant controls, capabilities, current task, and skill override affordance", () => {
    const members: ParticipantViewModel[] = [
      {
        id: "binding_builder",
        agentBindingId: "binding_builder",
        roleId: "role_builder",
        name: "Builder",
        role: "teammate",
        presence: "active",
        adapterId: "native",
        capabilities: ["code.edit", "file.write"]
      }
    ];
    const tasks: TaskViewModel[] = [
      {
        id: "task_build",
        title: "Build member management UI",
        status: "in_progress",
        assigneeBindingId: "binding_builder"
      }
    ];

    const html = renderToStaticMarkup(
      createElement(MembersPanel, {
        roomId: "room_1",
        members,
        tasks,
        csrfFetch: vi.fn<typeof fetch>()
      })
    );

    expect(html).toContain("添加队友");
    expect(html).toContain("房间技能");
    expect(html).toContain("房间技能开关");
    expect(html).toContain("构建者");
    expect(html).toContain("协作者 / AgentHub");
    expect(html).toContain("code.edit");
    expect(html).toContain("file.write");
    expect(html).toContain("Build member management UI");
    expect(html).toContain("进行中");
    expect(html).toContain("技能");
    expect(html).toContain('class="ah-member-skills" data-open="false"');
    expect(html).toMatch(
      /<button[^>]*class="ah-member-skills-summary"[^>]*aria-expanded="false"/
    );
    expect(html).toContain("ah-member-skills-count");
    expect(html).toContain("展开配置");
  });
});
