import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = "11111111-1111-4111-8111-111111111111"
async function fixture(
  page: Page,
  options: {
    role?: string
    superuser?: boolean
    loggedOut?: boolean
    packageStatus?: number
  } = {},
) {
  const state = { keys: 0, downloads: 0, authorization: "" }
  await page.addInitScript(
    ({ loggedOut }) => {
      if (!loggedOut) localStorage.setItem("access_token", "fixture-token")
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            ;(window as unknown as { copied: string }).copied = text
          },
        },
      })
    },
    { loggedOut: options.loggedOut },
  )
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/login/access-token"))
      return route.fulfill({
        json: { access_token: "fixture-token", token_type: "bearer" },
      })
    if (path.endsWith("/users/me"))
      return route.fulfill({
        json: {
          id: "user",
          email: "test@example.invalid",
          full_name: "测试用户",
          is_active: true,
          is_superuser: options.superuser ?? true,
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
    if (path.endsWith("/members"))
      return route.fulfill({
        json: {
          items: [
            {
              user_id: "user",
              email: "test@example.invalid",
              full_name: "测试用户",
              role: "admin",
            },
          ],
        },
      })
    if (path.endsWith("/extension-keys")) {
      state.keys++
      return route.fulfill({ json: { items: [] } })
    }
    if (path.endsWith("/extension/package")) {
      state.downloads++
      state.authorization = route.request().headers().authorization
      if (options.packageStatus)
        return route.fulfill({
          status: options.packageStatus,
          json: {
            error: {
              code: "EXTENSION_PACKAGE_UNAVAILABLE",
              message: "请求失败",
              details: {},
              request_id: "package-failed",
            },
          },
        })
      return route.fulfill({
        contentType: "application/zip",
        headers: {
          "Content-Disposition": 'attachment; filename="results-helper.zip"',
        },
        body: Buffer.from("mock-package"),
      })
    }
    return route.fulfill({ json: { items: [], total: 0 } })
  })
  return state
}

test.describe("R6 shell settings", () => {
  test("标签只显示对应内容，URL、刷新和历史导航保持同步", async ({ page }) => {
    const state = await fixture(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/settings")
    await expect(page.getByRole("button", { name: "保存资料" })).toBeVisible()
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "模型与密钥" })).toHaveCount(
      0,
    )
    expect(state.keys).toBe(0)
    await page.getByRole("tab", { name: "修改密码" }).click()
    await expect(page).toHaveURL(/tab=password/)
    await expect(page.getByLabel("当前密码", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "保存资料" })).toHaveCount(0)
    await page.getByRole("tab", { name: "模型与密钥" }).click()
    await expect(
      page.getByRole("heading", { name: "模型与密钥" }),
    ).toBeVisible()
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveCount(0)
    await page.getByRole("tab", { name: "浏览器插件" }).click()
    await expect(page).toHaveURL(/tab=plugin/)
    await expect(
      page.getByRole("heading", { name: "插件密钥管理" }),
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "模型与密钥" })).toHaveCount(
      0,
    )
    await page.reload()
    await expect(page.getByRole("tab", { name: "浏览器插件" })).toHaveAttribute(
      "data-state",
      "active",
    )
    await page.getByRole("tab", { name: "我的资料" }).click()
    await page.goBack()
    await expect(
      page.getByRole("heading", { name: "插件密钥管理" }),
    ).toBeVisible()
    await page.goto("/settings?tab=invalid")
    await expect(page.getByRole("tab", { name: "我的资料" })).toHaveAttribute(
      "data-state",
      "active",
    )
  })

  test("旧密钥地址重定向，导航无首页与插件密钥入口", async ({ page }) => {
    await fixture(page)
    await page.goto("/extension-keys")
    await expect(page).toHaveURL(/\/settings\?tab=plugin$/)
    await expect(page.getByRole("tab", { name: "浏览器插件" })).toHaveAttribute(
      "data-state",
      "active",
    )
    await expect(
      page.getByRole("link", { name: "插件密钥", exact: true }),
    ).toHaveCount(0)
    await expect(page.locator('[data-slot="sidebar"] a[href="/"]')).toHaveCount(
      0,
    )
  })

  for (const superuser of [true, false])
    test(`非品牌管理员不显示插件标签且直达无权限 platform=${superuser}`, async ({
      page,
    }) => {
      const state = await fixture(page, { role: "editor", superuser })
      await page.goto("/extension-keys")
      await expect(page.getByText("没有权限查看这个页面")).toBeVisible()
      await expect(page.getByRole("tab", { name: "浏览器插件" })).toHaveCount(0)
      expect(state.keys).toBe(0)
    })

  test("品牌管理员无需平台管理员身份可用插件标签", async ({ page }) => {
    await fixture(page, { superuser: false })
    await page.goto("/settings?tab=plugin")
    await expect(page.getByRole("tab", { name: "浏览器插件" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "模型与密钥" })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "创建首枚密钥" }),
    ).toBeVisible()
  })

  test("密码图标表示当前状态，操作标签表示点击后的动作", async ({ page }) => {
    await fixture(page, { loggedOut: true })
    await page.goto("/login")
    const input = page.getByTestId("password-input")
    const show = page.getByRole("button", { name: "显示密码", exact: true })
    await expect(input).toHaveAttribute("type", "password")
    await expect(show.locator("svg")).toHaveClass(/lucide-eye-off/)
    await show.click()
    await expect(input).toHaveAttribute("type", "text")
    const hide = page.getByRole("button", { name: "隐藏密码", exact: true })
    await expect(hide.locator("svg")).toHaveClass(/lucide-eye(?!-off)/)
    await hide.click()
    await expect(input).toHaveAttribute("type", "password")
    await page.getByTestId("email-input").fill("test@example.invalid")
    await input.fill("fixture-password")
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expect(page).toHaveURL(/\/generate$/)
    await expect(
      page.getByRole("heading", { name: "生成工作台", exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/欢迎回来|你好，/)).toHaveCount(0)
    await page.goto("/settings?tab=password")
    const toggles = page.getByRole("button", { name: "显示密码", exact: true })
    await expect(toggles).toHaveCount(3)
    for (const toggle of await toggles.all())
      await expect(toggle.locator("svg")).toHaveClass(/lucide-eye-off/)
    await toggles.first().click()
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveAttribute(
      "type",
      "text",
    )
  })

  test("根路径和已登录访问登录页直接进入生成工作台", async ({ page }) => {
    await fixture(page)
    for (const path of ["/", "/login"]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/generate$/)
      await expect(
        page.getByRole("heading", { name: "生成工作台", exact: true }),
      ).toBeVisible()
    }
  })

  for (const width of [1440, 1280, 720])
    test(`品牌区域上下排列、安装四步图和标签无溢出 ${width}`, async ({
      page,
    }, testInfo) => {
      const logs: string[] = []
      page.on("pageerror", (error) => logs.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") logs.push(message.text())
      })
      await fixture(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/brands")
      const members = page.getByRole("heading", { name: "当前品牌成员" })
      const brands = page.getByRole("heading", { name: "我的品牌列表" })
      await expect(members).toBeVisible()
      await expect(page.getByRole("button", { name: "添加成员" })).toBeVisible()
      const a = (await members.boundingBox())!,
        b = (await brands.boundingBox())!
      expect(a.y).toBeLessThan(b.y)
      expect(a.x).toBe(b.x)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`brands-${width}.png`),
        fullPage: true,
      })
      await page.goto("/settings?tab=plugin")
      await page.getByText("使用说明", { exact: true }).click()
      await expect(page.getByRole("img", { name: /步骤示意图/ })).toHaveCount(4)
      await expect(
        page.getByText(/要选到里面直接有 manifest.json 的那一层/),
      ).toBeVisible()
      await expect(page.getByText(/更新插件：/)).toBeVisible()
      await page.getByRole("button", { name: "复制扩展程序地址" }).click()
      expect(
        await page.evaluate(
          () => (window as unknown as { copied: string }).copied,
        ),
      ).toBe("chrome://extensions")
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`plugin-guide-${width}.png`),
        fullPage: true,
      })
      expect(logs).toEqual([])
    })

  test("下载使用现有鉴权客户端并保存 zip", async ({ page }) => {
    const state = await fixture(page)
    await page.goto("/settings?tab=plugin")
    await page.getByText("使用说明", { exact: true }).click()
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "下载插件包", exact: true }).click()
    expect((await download).suggestedFilename()).toBe("results-helper.zip")
    expect(state.downloads).toBe(1)
    expect(state.authorization).toBe("Bearer fixture-token")
  })

  test("下载失败显示通用错误和 request_id，可重试", async ({ page }) => {
    const state = await fixture(page, { packageStatus: 503 })
    await page.goto("/settings?tab=plugin")
    await page.getByText("使用说明", { exact: true }).click()
    await page.getByRole("button", { name: "下载插件包", exact: true }).click()
    await expect(
      page.getByText("package-failed", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText("EXTENSION_PACKAGE_UNAVAILABLE", { exact: true }),
    ).toHaveCount(0)
    await page.getByRole("button", { name: "下载插件包", exact: true }).click()
    await expect.poll(() => state.downloads).toBe(2)
  })
})
