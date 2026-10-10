import { test, expect, type Page } from "@playwright/test";

const headers = { "X-Requested-With": "class-island" };

async function loginAdmin(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("e2e-admin-password");
  await page.getByRole("button", { name: "进入我的小岛" }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeAttached();
}

async function createMember(page: Page, username: string, name: string) {
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      username,
      name,
      student_no: "20260010",
      password: "student-password",
    },
  });
  expect(registered.status()).toBe(201);
  const users = await (await page.request.get("/api/users")).json();
  const user = users.find((u: { username: string }) => u.username === username);
  expect(user).toBeTruthy();
  return user as { id: number; username: string; name: string };
}

for (const status of ["pending", "approved", "rejected"] as const) {
  test(`管理员确认删除 ${status} 成员及资料，取消时保留账号`, async ({
    page,
  }) => {
    await loginAdmin(page);
    const member = await createMember(
      page,
      `delete_${status}`,
      `删除验证${status}`,
    );
    if (status !== "pending") {
      const response = await page.request.patch(
        `/api/users/${member.id}/status`,
        {
          headers,
          data: { status },
        },
      );
      expect(response.status()).toBe(200);
    }
    const projectResponse = await page.request.post("/api/projects", {
      headers,
      data: {
        title: `成员删除验证 ${status}`,
        published: true,
        fields: [
          { id: "name", label: "姓名", type: "text", required: true },
          { id: "file", label: "附件", type: "file" },
        ],
      },
    });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json();
    const upload = await page.request.post(
      `/api/projects/${project.id}/files/file?user_id=${member.id}`,
      {
        headers,
        multipart: {
          file: {
            name: "删除验证.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-member-original"),
          },
        },
      },
    );
    expect(upload.status()).toBe(201);
    const file = await upload.json();
    const submitted = await page.request.put(
      `/api/projects/${project.id}/submission?user_id=${member.id}`,
      { headers, data: { answers: { name: member.name, file: [file.id] } } },
    );
    expect(submitted.status()).toBe(200);
    await page.getByRole("button", { name: "班级成员", exact: true }).click();
    await expect(page.getByRole("heading", { name: "小岛成员" })).toBeVisible();
    const adminRow = page.getByRole("row").filter({ hasText: "超级管理员" });
    await expect(adminRow).toBeVisible();
    await expect(
      adminRow.getByRole("button", { name: "删除", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("搜索成员").fill(member.username);
    const row = page.getByRole("row").filter({ hasText: member.name });
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: "删除", exact: true }),
    ).toHaveCSS("color", "rgb(171, 81, 59)");
    await expect(page.locator(".workbook-bottom")).toHaveText("共 1 位成员");
    if (status === "approved") {
      await expect(
        row.getByRole("button", { name: "停用", exact: true }),
      ).toBeVisible();
    }
    let deletions = 0;
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        request.url().endsWith(`/api/users/${member.id}`)
      ) {
        deletions += 1;
      }
    });
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(member.name);
      expect(dialog.message()).toContain(`@${member.username}`);
      expect(dialog.message()).toContain("填写记录及上传附件");
      expect(dialog.message()).toContain("无法恢复");
      await dialog.dismiss();
    });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await expect(row).toBeVisible();
    expect(deletions).toBe(0);
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(deletions).toBe(1);
    await expect(
      page.getByRole("status").filter({ hasText: `已删除 ${member.name}` }),
    ).toHaveText(`已删除 ${member.name} 的账号及相关资料`);
    await expect(page.locator(".workbook-bottom")).toHaveText("共 0 位成员");
    expect((await page.request.get(`/api/files/${file.id}`)).status()).toBe(
      404,
    );
    const submissions = await page.request.get(
      `/api/projects/${project.id}/submissions`,
    );
    expect(await submissions.json()).toEqual([]);
    await page.reload();
    await page.getByRole("button", { name: "班级成员", exact: true }).click();
    await page.getByLabel("搜索成员").fill(member.username);
    await expect(row).toHaveCount(0);
    // The suite shares an E2E server; do not leave projects for later workflows.
    expect(
      (
        await page.request.delete(`/api/projects/${project.id}`, { headers })
      ).status(),
    ).toBe(200);
  });
}

test("手机端删除失败保留成员、提示错误并可重试", async ({ page }, testInfo) => {
  await loginAdmin(page);
  const member = await createMember(page, "delete_retry", "删除重试同学");
  await page.getByRole("button", { name: "班级成员", exact: true }).click();
  await page.getByLabel("搜索成员").fill(member.username);
  await page.setViewportSize({ width: 390, height: 844 });
  const row = page.getByRole("row").filter({ hasText: member.name });
  const deleteButton = row.getByRole("button", { name: "删除", exact: true });
  const url = `**/api/users/${member.id}`;
  await page.route(url, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "删除失败，请稍后重试" }),
    }),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(page.getByRole("alert")).toContainText("删除失败，请稍后重试");
  await expect(row).toBeVisible();
  await expect(deleteButton).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("member-deletion-mobile.png"),
    fullPage: true,
  });
  await page.unroute(url);
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: `已删除 ${member.name}` }),
  ).toHaveText(`已删除 ${member.name} 的账号及相关资料`);
});
