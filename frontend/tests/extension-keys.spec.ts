import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = "11111111-1111-4111-8111-111111111111"
const secret = "rnk_fixture_one_time_secret_only"
const row = {
  id: "key-one",
  label: "工作电脑",
  prefix: "returned_prefix",
  created_at: "2026-11-01T00:00:00Z",
  last_used_at: null,
  revoked_at: null as string | null,
}

async function fixture(
  page: Page,
  options: {
    empty?: boolean
    role?: string
    status?: number
    createStatus?: number
    revokeStatus?: number
  } = {},
) {
  const state = {
    rows: options.empty ? [] : [{ ...row }],
    creates: [] as unknown[],
    deletes: 0,
    reads: 0,
  }
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "fixture-token")
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          ;(window as unknown as { copied: string }).copied = value
        },
      },
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    const fail = (status: number) =>
      route.fulfill({
        status,
        json: {
          error: {
            code: "ERROR",
            message: "请求失败",
            details: {},
            request_id: `extension-${status}`,
          },
        },
      })
    if (path.endsWith("/users/me"))
      return route.fulfill({
        json: {
          id: "user",
          email: "test@example.invalid",
          full_name: "测试用户",
          is_active: true,
          is_superuser: true,
        },
      })
    if (path === "/api/v1/brands")
      return route.fulfill({
        json: {
          items: [
            {
              id: brand,
              name: "测试品牌",
              category: "perfume",
              role: options.role ?? "admin",
            },
          ],
        },
      })
    if (path.includes("/extension-keys")) {
      if (request.method() === "GET") {
        state.reads++
        return options.status
          ? fail(options.status)
          : route.fulfill({ json: { items: state.rows } })
      }
      if (request.method() === "POST") {
        state.creates.push(request.postDataJSON())
        if (options.createStatus) return fail(options.createStatus)
        const created = {
          ...row,
          id: "key-new",
          label: request.postDataJSON().label,
        }
        state.rows.push(created)
        return route.fulfill({ status: 201, json: { ...created, key: secret } })
      }
      state.deletes++
      if (options.revokeStatus) return fail(options.revokeStatus)
      state.rows[0].revoked_at = "2026-11-02T00:00:00Z"
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ json: { items: [], total: 0 } })
  })
  return state
}

test.describe("extension keys", () => {
  test("列表、使用说明与空态", async ({ page }) => {
    await fixture(page)
    await page.goto("/extension-keys")
    for (const name of ["名称", "前缀", "创建时间", "最后使用时间", "状态"])
      await expect(
        page.getByRole("columnheader", { name, exact: true }),
      ).toBeVisible()
    await expect(page.getByRole("cell", { name: row.prefix })).toBeVisible()
    await expect(page.getByText("尚未使用")).toBeVisible()
    await page.getByText("使用说明", { exact: true }).click()
    await expect(
      page.getByRole("heading", {
        name: "3 加载已解压的扩展程序",
        exact: true,
      }),
    ).toBeVisible()
  })

  test("空态、创建一次展示与两个复制按钮、关闭及刷新后不再出现", async ({
    page,
  }) => {
    const state = await fixture(page, { empty: true })
    const logs: string[] = []
    page.on("console", (message) => logs.push(message.text()))
    await page.goto("/extension-keys")
    await page.getByRole("button", { name: "创建首枚密钥" }).click()
    await page.getByLabel("名称", { exact: true }).fill("  新密钥  ")
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "创建密钥", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByText("含密钥，只显示这一次，关闭后无法再取"),
    ).toBeVisible()
    await expect(page.getByLabel("完整密钥", { exact: true })).toHaveValue(
      secret,
    )
    const config = await page
      .getByLabel("连接配置串", { exact: true })
      .inputValue()
    expect(
      JSON.parse(Buffer.from(config.slice(5), "base64url").toString()),
    ).toEqual({ s: new URL(page.url()).origin, k: secret })
    for (const [name, value] of [
      ["复制密钥", secret],
      ["复制连接配置串", config],
    ]) {
      await dialog.getByRole("button", { name, exact: true }).click()
      expect(
        await page.evaluate(
          () => (window as unknown as { copied: string }).copied,
        ),
      ).toBe(value)
    }
    expect(state.creates).toEqual([{ label: "新密钥" }])
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click()
    await expect(dialog).toHaveCount(0)
    expect(await page.content()).not.toContain(secret)
    await page.getByRole("button", { name: "创建密钥", exact: true }).click()
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue("")
    expect(await page.content()).not.toContain(secret)
    await page.reload()
    await expect(
      page.getByRole("cell", { name: "新密钥", exact: true }),
    ).toBeVisible()
    expect(await page.content()).not.toContain(secret)
    expect(await page.content()).not.toContain(config)
    expect(logs.join("\n")).not.toContain(secret)
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain(secret)
  })

  test("切换设置标签后清除一次性密钥与连接配置", async ({ page }) => {
    await fixture(page, { empty: true })
    await page.goto("/settings?tab=profile")
    await page.getByRole("tab", { name: "浏览器插件" }).click()
    await page.getByRole("button", { name: "创建首枚密钥" }).click()
    await page.getByLabel("名称", { exact: true }).fill("切换前密钥")
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "创建密钥", exact: true })
      .click()
    await expect(page.getByLabel("完整密钥", { exact: true })).toHaveValue(
      secret,
    )
    const config = await page
      .getByLabel("连接配置串", { exact: true })
      .inputValue()
    // A route/brand change can unmount the tab even while a dialog is open.
    await page.goBack()
    await expect(page.getByRole("button", { name: "保存资料" })).toBeVisible()
    expect(await page.content()).not.toContain(secret)
    await page.getByRole("tab", { name: "浏览器插件" }).click()
    await expect(
      page.getByRole("cell", { name: "切换前密钥", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(await page.content()).not.toContain(secret)
    expect(await page.content()).not.toContain(config)
  })

  test("名称校验与上限 422", async ({ page }) => {
    const state = await fixture(page, { createStatus: 422 })
    await page.goto("/extension-keys")
    await page.getByRole("button", { name: "创建密钥", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await page.getByLabel("名称", { exact: true }).fill(" ")
    await dialog.getByRole("button", { name: "创建密钥", exact: true }).click()
    await expect(page.getByText("请输入 1–60 个字符的名称")).toBeVisible()
    await page.getByLabel("名称", { exact: true }).fill("名".repeat(61))
    await dialog.getByRole("button", { name: "创建密钥", exact: true }).click()
    expect(state.creates).toHaveLength(0)
    await page.getByLabel("名称", { exact: true }).fill("名".repeat(60))
    await dialog.getByRole("button", { name: "创建密钥", exact: true }).click()
    await expect(
      page.getByText("有效密钥已达 10 个上限，请先作废不用的"),
    ).toBeVisible()
    await expect(page.getByText("extension-422", { exact: true })).toBeVisible()
  })

  test("作废二次确认、取消与成功灰显", async ({ page }) => {
    const state = await fixture(page)
    await page.goto("/extension-keys")
    await page.getByRole("button", { name: "作废", exact: true }).click()
    expect(state.deletes).toBe(0)
    await expect(page.getByRole("dialog").getByText(row.prefix)).toBeVisible()
    await page.getByRole("button", { name: "取消", exact: true }).click()
    expect(state.deletes).toBe(0)
    await page.getByRole("button", { name: "作废", exact: true }).click()
    await page.getByRole("button", { name: "确认作废" }).click()
    await expect(
      page.getByRole("cell", { name: "已作废", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: row.label }),
    ).toHaveClass(/opacity-60/)
    await expect(
      page.getByRole("button", { name: "作废", exact: true }),
    ).toHaveCount(0)
  })

  test("作废失败显示通用错误与请求编号", async ({ page }) => {
    await fixture(page, { revokeStatus: 500 })
    await page.goto("/extension-keys")
    await page.getByRole("button", { name: "作废", exact: true }).click()
    await page.getByRole("button", { name: "确认作废" }).click()
    await expect(page.getByText("extension-500", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "取消", exact: true }).click()
    await expect(
      page.getByRole("cell", { name: "有效", exact: true }),
    ).toBeVisible()
  })

  test("403 显示无权限与请求编号", async ({ page }) => {
    await fixture(page, { status: 403 })
    await page.goto("/extension-keys")
    await expect(page.getByText("没有权限查看这个页面")).toBeVisible()
    await expect(page.getByText("extension-403", { exact: true })).toBeVisible()
  })

  test("成员无权限且不请求密钥，平台管理员也不越权", async ({ page }) => {
    const state = await fixture(page, { role: "editor" })
    await page.goto("/extension-keys")
    await expect(page.getByText("没有权限查看这个页面")).toBeVisible()
    await expect(
      page.getByRole("link", { name: "插件密钥", exact: true }),
    ).toHaveCount(0)
    expect(state.reads).toBe(0)
  })

  for (const width of [1440, 1280])
    test(`${width}×900 无横向溢出`, async ({ page }, testInfo) => {
      const state = await fixture(page)
      state.rows[0].label = "长名称".repeat(20)
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/extension-keys")
      await expect(page.getByRole("cell", { name: row.prefix })).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`extension-keys-${width}.png`),
        fullPage: true,
      })
      await page.getByRole("button", { name: "创建密钥", exact: true }).click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    })
})
