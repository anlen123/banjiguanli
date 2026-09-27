import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入我的小岛" }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeAttached();
}

test("班长发布、审核学生、手机填写、导出与截止重新开放", async ({
  browser,
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回到小岛" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await login(page, "admin", "e2e-admin-password");
  await page.getByRole("button", { name: "新建收集项目", exact: true }).click();
  await page.getByLabel("项目标题").fill("新学期 · 班级信息登记");
  await page
    .getByLabel("填写说明")
    .fill(
      "新的学期开始啦！请认真填写联系方式，并上传个人资料。资料仅用于班级事务管理。",
    );
  await page.getByLabel("问题标题", { exact: true }).fill("联系电话");
  await page.getByLabel("必填项", { exact: true }).check();
  await page.getByRole("button", { name: "添加一个问题" }).click();
  await page.getByLabel("问题标题", { exact: true }).nth(1).fill("个人资料");
  await page
    .getByRole("combobox", { name: "题型", exact: true })
    .nth(1)
    .selectOption("file");
  await page.getByLabel("发布给同学们").check();
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(
    page.getByRole("heading", { name: "新学期 · 班级信息登记", exact: true }),
  ).toBeVisible();

  const studentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    reducedMotion: "reduce",
  });
  const student = await studentContext.newPage();
  student.on("pageerror", (e) => errors.push(e.message));
  await student.goto("/");
  await student.getByRole("button", { name: "注册账号" }).click();
  await student.getByLabel("真实姓名").fill("陈小满");
  await student.getByLabel("学号", { exact: true }).fill("20260001");
  await student.getByLabel("用户名", { exact: true }).fill("xiaoman");
  await student.getByLabel("密码", { exact: true }).fill("student-password");
  await student.getByRole("button", { name: "注册并等待审核" }).click();
  await expect(student.getByRole("status")).toContainText("注册成功");
  await student.getByLabel("密码", { exact: true }).fill("student-password");
  await student.getByRole("button", { name: "进入我的小岛" }).click();
  await expect(student.getByRole("alert")).toContainText("等待管理员审核");

  await page.getByRole("button", { name: "班级成员" }).click();
  const studentRow = page.getByRole("row").filter({ hasText: "陈小满" });
  await studentRow.getByRole("button", { name: "通过", exact: true }).click();
  await expect(studentRow).toContainText("已通过");
  await student.getByRole("button", { name: "进入我的小岛" }).click();
  await expect(
    student.getByRole("heading", { name: "属于你的班级小天地" }),
  ).toBeVisible();
  await expect(student.getByRole("button", { name: "AI 小助手" })).toHaveCount(
    0,
  );
  await student.screenshot({
    path: testInfo.outputPath("student-mobile.png"),
    fullPage: true,
  });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await student.getByRole("button", { name: "去填写" }).click();
  await student.getByLabel("联系电话").fill("13800138000");
  await student
    .getByLabel("个人资料", { exact: true })
    .setInputFiles({
      name: "自我介绍.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test document"),
    });
  await expect(
    student.getByRole("link", { name: "自我介绍.pdf" }),
  ).toBeVisible();
  await student.screenshot({
    path: testInfo.outputPath("form-mobile.png"),
    fullPage: true,
  });
  await student.getByRole("button", { name: "提交资料", exact: true }).click();
  await expect(student.getByRole("status")).toContainText("资料已提交");
  await student.getByRole("button", { name: "修改填写" }).click();
  await student.getByLabel("联系电话").fill("13900139000");
  await student.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(student.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "收集项目", exact: true }).click();
  await page.getByRole("button", { name: "查看资料" }).click();
  await expect(
    page.getByRole("cell", { name: "13900139000", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "自我介绍.pdf" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("results-desktop.png"),
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByRole("button", { name: "回到收集项目" }).click();
  await page.getByRole("button", { name: "编辑问卷" }).click();
  await page.getByLabel("截止时间（本地时区）").fill("2020-01-01T12:00");
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await student.reload();
  await student.getByRole("button", { name: "查看填写" }).click();
  await expect(student.getByLabel("联系电话")).toBeDisabled();
  await expect(student.getByRole("button", { name: "保存修改" })).toHaveCount(
    0,
  );
  await student.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "查看资料" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("联系电话").fill("管理员截止后修正");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "管理员截止后修正", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "回到收集项目" }).click();
  await page.getByRole("button", { name: "编辑问卷" }).click();
  await page.getByLabel("截止时间（本地时区）").fill("2099-01-01T12:00");
  await page.getByRole("button", { name: "保存并发布" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await student.reload();
  await student.getByRole("button", { name: "修改填写" }).click();
  await expect(student.getByLabel("联系电话")).toBeEnabled();
  await expect(student.getByLabel("联系电话")).toHaveValue("管理员截止后修正");

  await page.getByRole("button", { name: "AI 小助手" }).click();
  await expect(page.getByLabel("API Base URL")).toBeVisible();
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(
    page.getByRole("heading", { name: "嗨，今天想一起做点什么？" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("assistant-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "收集项目", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await studentContext.close();
});
