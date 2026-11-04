import { expect, type Page, test } from "@playwright/test"
import { analysisIds as ids, mockAnalysis } from "./utils/analysisVisual"
import { revealChangeControls } from "./utils/flowControls"
import { mockResult, resultUrl } from "./utils/resultVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const taskId = "99999999-9999-4999-8999-999999999999"
const adminMessage = "还没有配置模型密钥。请到「设置 → 模型」填写后再试"
const taskMessage = "还没有配置模型密钥，请管理员到「设置 → 模型」填写后重试"
const memberMessage = "还没有配置模型密钥，请联系管理员"

async function setup(page: Page, admin: boolean, configured = false) {
  await mockAnalysis(page)
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "fixture-user",
        email: "fixture@example.invalid",
        full_name: "测试成员",
        is_superuser: admin,
        is_active: true,
      },
    }),
  )
  // Keep brand admin independent of platform admin: this user may upload,
  // but only the platform admin has access to model settings.
  await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  )
  await page.route(`**/api/v1/tasks/${taskId}`, (route) =>
    route.fulfill({
      json: {
        id: taskId,
        brand_id: ids.brand,
        product_name: "测试商品",
        scenario_name: "测试场景",
        created_at: "2026-11-01T00:00:00Z",
        flow_status: "queued",
        progress: null,
        last_error: configured ? "model_unavailable" : "model_not_configured",
        latest_version_id: null,
        required_terms: [],
        brief: "测试任务",
      },
    }),
  )
  await page.route(`**/api/v1/tasks/${taskId}/versions`, (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route(`**/api/v1/tasks/${taskId}/materials`, (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route("**/api/v1/models", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "test-model", model_name: "测试模型", enabled: true }],
      },
    }),
  )
  const fail = (route: import("@playwright/test").Route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "Model provider is unavailable",
          details: configured ? {} : { reason: "model_not_configured" },
          request_id: "req-model-configuration",
        },
      },
    })
  await page.route("**/api/v1/brands/*/knowledge-documents", fail)
  await page.route("**/api/v1/viral-samples/*/analyze", fail)
}

async function guidance(page: Page, admin: boolean, task = false) {
  await expect(
    page.getByText(
      admin ? (task ? taskMessage : adminMessage) : memberMessage,
      { exact: true },
    ),
  ).toBeVisible()
  const link = page.getByRole("link", { name: "前往设置", exact: true })
  if (admin) await expect(link).toHaveAttribute("href", "/settings?tab=models")
  else await expect(link).toHaveCount(0)
  await expect(
    page.getByText("model_not_configured", { exact: true }),
  ).toHaveCount(0)
}

async function upload(page: Page) {
  await page.goto("/knowledge")
  await page.getByRole("button", { name: "上传资料", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("测试资料"),
  })
  await dialog.getByRole("button", { name: "上传资料", exact: true }).click()
  return dialog
}
async function analyze(page: Page) {
  await page.goto(`/viral-samples/${ids.sample}`)
  await page.getByRole("button", { name: "分析结构", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "开始分析", exact: true }).click()
  return dialog
}

for (const admin of [true, false]) {
  test(`model configuration: upload guidance platform admin=${admin}`, async ({
    page,
  }) => {
    await setup(page, admin)
    const dialog = await upload(page)
    await guidance(page, admin)
    await expect(dialog.getByText("req-model-configuration")).toBeVisible()
    await expect(dialog.getByText("服务暂时不可用，请稍后重试")).toHaveCount(0)
  })
  for (const url of [`/tasks/${taskId}`, `/generate?task=${taskId}`]) {
    test(`model configuration: task guidance admin=${admin} ${url}`, async ({
      page,
    }) => {
      await setup(page, admin)
      await page.goto(url)
      await guidance(page, admin, true)
    })
  }
  test(`model configuration: analyze failure admin=${admin}`, async ({
    page,
  }) => {
    await setup(page, admin)
    const dialog = await analyze(page)
    await guidance(page, admin)
    await expect(dialog.getByText("req-model-configuration")).toBeVisible()
    await expect(dialog.getByText("请先读取结构列表核对")).toHaveCount(0)
  })
  test(`model configuration: no enabled model admin=${admin}`, async ({
    page,
  }) => {
    await setup(page, admin)
    await page.route("**/api/v1/models", (route) =>
      route.fulfill({
        json: {
          items: [{ id: "test-model", model_name: "测试模型", enabled: false }],
        },
      }),
    )
    await page.goto(`/viral-samples/${ids.sample}`)
    await page.getByRole("button", { name: "分析结构", exact: true }).click()
    await guidance(page, admin)
    await expect(
      page.getByRole("button", { name: "开始分析", exact: true }),
    ).toBeDisabled()
  })
}

test("model configuration: ordinary 503 and task outage preserve previous messages", async ({
  page,
}) => {
  await setup(page, true, true)
  const dialog = await upload(page)
  await expect(
    dialog.getByText("服务暂时不可用，请稍后重试。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "前往设置", exact: true }),
  ).toHaveCount(0)
  for (const url of [`/tasks/${taskId}`, `/generate?task=${taskId}`]) {
    await page.goto(url)
    await expect(
      page.getByText("模型暂时不可用，任务没有丢，可以直接重试。", {
        exact: true,
      }),
    ).toBeVisible()
  }
  const analysis = await analyze(page)
  await expect(
    analysis.getByText("Model provider is unavailable", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "前往设置", exact: true }),
  ).toHaveCount(0)
})

for (const width of [1280, 720]) {
  test(`model configuration: guidance fits ${width}px without page errors`, async ({
    page,
  }, info) => {
    await setup(page, true)
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    for (const url of [`/tasks/${taskId}`, `/generate?task=${taskId}`]) {
      await page.goto(url)
      await guidance(page, true, true)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true)
      await page.screenshot({
        path: info.outputPath(
          `${url.startsWith("/tasks") ? "task" : "generate"}-${width}.png`,
        ),
        fullPage: true,
      })
    }
    await analyze(page)
    await guidance(page, true)
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await page.screenshot({
      path: info.outputPath(`analysis-${width}.png`),
      fullPage: true,
    })
    expect(errors).toEqual([])
  })
}

for (const admin of [true, false]) {
  test(`model configuration: rewrite reason survives reload admin=${admin}`, async ({
    page,
  }) => {
    await mockResult(page, { risks: [] })
    await page.route("**/api/v1/users/me", (route) =>
      route.fulfill({
        json: {
          id: "fixture-user",
          email: "fixture@example.invalid",
          full_name: "测试成员",
          is_superuser: admin,
          is_active: true,
        },
      }),
    )
    await page.route("**/api/v1/generation-versions/*/revise", (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "Model provider is unavailable",
            details: { reason: "model_not_configured" },
            request_id: "req-model-configuration",
          },
        },
      }),
    )
    await page.goto(resultUrl)
    await revealChangeControls(page)
    await page.getByLabel("正文修改要求", { exact: true }).fill("调整正文语气")
    await page
      .getByRole("button", { name: "加入正文修改要求", exact: true })
      .click()
    await page
      .getByRole("button", { name: /^按清单改写（\d+ 项）$/, exact: true })
      .click()
    await guidance(page, admin)
    await expect(page.getByText("req-model-configuration")).toBeVisible()
    await page.reload()
    await guidance(page, admin)
  })
}

for (const admin of [true, false]) {
  test(`model configuration: new task material upload toast admin=${admin}`, async ({
    page,
  }) => {
    await setup(page, admin)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/api/v1/brands/*/products?*", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "测试商品",
              category: "perfume",
              status: "active",
              selling_points: [],
              notes: {},
            },
          ],
          total: 1,
        },
      }),
    )
    await page.route("**/api/v1/scenarios", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              name: "测试场景",
              scene: "seeding",
              template_version: 1,
              structure: "测试结构",
              brand_id: null,
            },
          ],
        },
      }),
    )
    await page.route("**/api/v1/brands/*/creative-types", (route) =>
      route.fulfill({
        json: {
          items: [
            { key: "seeding", name: "种草", builtin: true, template_count: 1 },
          ],
        },
      }),
    )
    await page.route("**/api/v1/brands/*/style-presets", (route) =>
      route.fulfill({ json: { items: [] } }),
    )
    await page.route("**/api/v1/tasks", (route) =>
      route.fulfill({ status: 201, json: { id: taskId } }),
    )
    // Upload failures do not set Task.last_error on the backend.
    await page.route(`**/api/v1/tasks/${taskId}`, (route) =>
      route.fulfill({
        json: {
          id: taskId,
          brand_id: ids.brand,
          product_name: "测试商品",
          scenario_name: "测试场景",
          flow_status: "queued",
          progress: null,
          last_error: null,
          latest_version_id: null,
        },
      }),
    )
    let uploads = 0
    let generations = 0
    await page.route(`**/api/v1/tasks/${taskId}/generate`, (route) => {
      generations++
      return route.fulfill({ status: 202, json: {} })
    })
    await page.route(`**/api/v1/tasks/${taskId}/materials`, (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { items: [] } })
      uploads++
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "Model provider is unavailable",
            details: { reason: "model_not_configured" },
            request_id: "req-new-task-upload",
          },
        },
      })
    })
    await page.goto("/generate")
    await page.getByRole("combobox", { name: "选择商品", exact: true }).click()
    await page.getByRole("option", { name: "测试商品", exact: true }).click()
    await page
      .getByRole("radiogroup", { name: "场景", exact: true })
      .getByText("种草", { exact: true })
      .click()
    await page.locator('input[type="file"]').setInputFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("测试任务资料"),
    })
    await page
      .getByRole("button", { name: "创建并开始生成", exact: true })
      .click()
    await expect.poll(() => uploads).toBe(1)
    await expect(page).toHaveURL(`/generate?task=${taskId}`)
    const toast = page.locator("[data-sonner-toast]")
    await expect(toast).toContainText(admin ? adminMessage : memberMessage)
    await expect(toast.getByRole("link")).toHaveCount(0)
    const content = page.locator("main")
    await expect(
      content.getByText(admin ? adminMessage : memberMessage, { exact: true }),
    ).toBeVisible()
    const settings = content.getByRole("link", {
      name: "前往设置",
      exact: true,
    })
    if (admin)
      await expect(settings).toHaveAttribute("href", "/settings?tab=models")
    else await expect(settings).toHaveCount(0)
    await expect(content.getByText("req-new-task-upload")).toBeVisible()
    expect(generations).toBe(0)
    expect(errors).toEqual([])
  })
}
