import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入我的小岛" }).click();
  await expect(
    page.getByRole("heading", {
      name: /班级事务，轻松收好|属于你的班级小天地/,
    }),
  ).toBeVisible();
}

test("班长自己填写、两种离线导出、学生撤回及项目删除", async ({
  page,
  browser,
}, testInfo) => {
  await login(page, "admin", "e2e-admin-password");
  const headers = { "X-Requested-With": "class-island" };
  const response = await page.request.post("/api/projects", {
    headers,
    data: {
      title: "班长也要填写 · 撤回验证",
      published: true,
      fields: [
        { id: "name", label: "收集姓名", type: "text", required: true },
        { id: "file", label: "证明附件", type: "file" },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.reload();
  const card = page.locator("article").filter({ hasText: project.title });
  await card.getByRole("button", { name: "填写我的资料", exact: true }).click();
  await page.getByLabel("收集姓名").fill("班长本人资料");
  await page.getByLabel("证明附件", { exact: true }).setInputFiles({
    name: "班长.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-admin-original"),
  });
  await expect(page.getByRole("link", { name: "班长.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "提交资料", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "修改我的资料" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "班级设置", exact: true }).click();
  await page.getByLabel("班级名称", { exact: true }).fill("2026级计算机一班");
  await page.getByRole("button", { name: "保存班级名称", exact: true }).click();
  await expect(
    page.getByText("班级名称已保存，后续导出将使用新的名称前缀。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("我的真实姓名", { exact: true }).fill("陈小雨");
  await page.getByLabel("我的学号（选填）", { exact: true }).fill("20260009");
  await page.getByRole("button", { name: "保存我的资料", exact: true }).click();
  await expect(page.locator(".sidebar-user strong")).toHaveText("陈小雨");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("class-settings-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.locator(".class-name")).toHaveText("2026级计算机一班");
  await expect(page.locator(".sidebar-user strong")).toHaveText("陈小雨");
  await card.getByRole("button", { name: "查看资料" }).click();
  await expect(
    page.getByRole("cell", { name: "陈小雨 20260009", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "班长本人资料", exact: true }),
  ).toBeVisible();
  for (const [label, suffix] of [
    ["导出 Excel", ".xlsx"],
    ["下载资料包 ZIP", ".zip"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(
      `2026级计算机一班_${project.title}${suffix}`,
    );
    await download.saveAs(testInfo.outputPath(`admin-export${suffix}`));
    expect(await download.failure()).toBeNull();
  }
  await page.getByRole("button", { name: "回到收集项目" }).click();
  await card.getByRole("button", { name: "修改我的资料" }).click();
  await page.getByLabel("收集姓名").fill("班长更新资料");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      username: "withdraw_student",
      password: "student-password",
      name: "撤回同学",
      student_no: "20260002",
    },
  });
  expect(registered.status()).toBe(201);
  const users = await (await page.request.get("/api/users")).json();
  const studentUser = users.find(
    (u: { username: string }) => u.username === "withdraw_student",
  );
  expect(
    (
      await page.request.patch(`/api/users/${studentUser.id}/status`, {
        headers,
        data: { status: "approved" },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const student = await context.newPage();
  await login(student, "withdraw_student", "student-password");
  await expect(student.locator(".class-name")).toHaveText("2026级计算机一班");
  await expect(
    student.getByRole("button", { name: "班级设置", exact: true }),
  ).toHaveCount(0);
  const studentCard = student
    .locator("article")
    .filter({ hasText: project.title });
  await studentCard.getByRole("button", { name: "去填写" }).click();
  await student.getByLabel("收集姓名").fill("学生资料");
  await student.getByRole("button", { name: "提交资料", exact: true }).click();
  await studentCard.getByRole("button", { name: "修改填写" }).click();
  student.once("dialog", (d) => d.dismiss());
  await student.getByRole("button", { name: "撤回填写", exact: true }).click();
  await expect(student.getByLabel("收集姓名")).toHaveValue("学生资料");
  student.once("dialog", (d) => d.accept());
  await student.getByRole("button", { name: "撤回填写", exact: true }).click();
  await expect(student.getByRole("dialog")).toHaveCount(0);
  await expect(
    studentCard.getByRole("button", { name: "去填写" }),
  ).toBeVisible();
  await studentCard.getByRole("button", { name: "去填写" }).click();
  await expect(student.getByLabel("收集姓名")).toHaveValue("");
  await student.getByLabel("收集姓名").fill("学生重新填写");
  await student.getByRole("button", { name: "提交资料", exact: true }).click();
  await expect(student.getByRole("dialog")).toHaveCount(0);

  page.once("dialog", (d) => d.dismiss());
  await card.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(card).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await page.request.get(`/api/projects/${project.id}`)).status()).toBe(
    404,
  );
  await student.reload();
  await expect(studentCard).toHaveCount(0);
  await context.close();
});
