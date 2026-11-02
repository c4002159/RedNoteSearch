import { expect, type Page, test } from "@playwright/test"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

const structure =
  "开头：从日常场景切入。\n\n展开：描述有来源的感受 🌿。\n结尾：以开放问题收尾。"
const templates = [
  {
    id: "global-template",
    brand_id: null,
    name: "内置种草模板（演示）",
    scene: "seeding",
    structure,
    template_version: 1,
    enabled: true,
    source_pattern_id: null,
    source_pattern_title: null,
  },
  {
    id: "brand-v1",
    brand_id: analysisIds.brand,
    name: "品牌种草模板（演示）",
    scene: "seeding",
    structure,
    template_version: 1,
    enabled: false,
    source_pattern_id: analysisIds.pattern,
    source_pattern_title: "生活场景切入（演示）",
  },
  {
    id: "brand-v2",
    brand_id: analysisIds.brand,
    name: "品牌种草模板（演示）",
    scene: "seeding",
    structure: "新版本的结构（演示）",
    template_version: 2,
    enabled: true,
    source_pattern_id: null,
    source_pattern_title: null,
  },
  {
    id: "review-template",
    brand_id: analysisIds.brand,
    name: "品牌测评模板（演示）",
    scene: "review",
    structure,
    template_version: 1,
    enabled: true,
    source_pattern_id: null,
    source_pattern_title: null,
  },
]

async function setup(page: Page, editor = false) {
  await mockAnalysis(page, editor)
  let items = templates.map((row) => ({ ...row }))
  const writes: { path: string; body: Record<string, unknown> }[] = []
  await page.route("**/api/v1/brands/*/scenario-templates", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items } })
    const body = route.request().postDataJSON()
    writes.push({ path: new URL(route.request().url()).pathname, body })
    const created = {
      ...items[1],
      ...body,
      id: "brand-v3",
      template_version: 3,
      enabled: true,
    }
    items = [
      ...items.map((row) =>
        row.brand_id === analysisIds.brand && row.name === body.name
          ? { ...row, enabled: false }
          : row,
      ),
      created,
    ]
    return route.fulfill({ status: 201, json: created })
  })
  return writes
}

test("A row opens full template details and admin can save the old version as a new version", async ({
  page,
}, info) => {
  const writes = await setup(page)
  await page.goto("/scenarios")
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "查看模板详情：品牌种草模板（演示） v1",
      exact: true,
    }),
  })
  await row.getByRole("cell").nth(1).click()
  const drawer = page.getByRole("dialog", {
    name: "模板详情 · 品牌种草模板（演示）",
    exact: true,
  })
  await expect(drawer).toContainText(structure)
  await expect(drawer).toContainText("已被新版本取代")
  await expect(
    drawer.getByRole("link", { name: "生活场景切入（演示）", exact: true }),
  ).toHaveAttribute("href", `/viral-patterns/${analysisIds.pattern}`)
  for (const width of [1433, 1024, 720]) {
    await page.setViewportSize({ width, height: 900 })
    await expect
      .poll(() =>
        drawer.evaluate(
          (element) =>
            Math.abs(
              element.getBoundingClientRect().right - window.innerWidth,
            ) < 1,
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await page.screenshot({
      path: info.outputPath(`template-detail-${width}.png`),
    })
  }
  await drawer.getByRole("button", { name: "存为新版本", exact: true }).click()
  await expect(drawer).toHaveCount(0)
  const dialog = page.getByRole("dialog", { name: "存为新版本", exact: true })
  await expect(dialog.getByLabel("结构指引", { exact: true })).toHaveValue(
    structure,
  )
  await expect(dialog.getByLabel("模板名称", { exact: true })).toHaveValue(
    "品牌种草模板（演示）",
  )
  await dialog.getByLabel("结构指引", { exact: true }).fill("字".repeat(2001))
  await expect(
    dialog.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled()
  const text = `${"字".repeat(1999)}🌿`
  await dialog.getByLabel("结构指引", { exact: true }).fill(text)
  await expect(dialog.getByLabel("结构指引", { exact: true })).toHaveValue(text)
  await expect(dialog).toContainText("2000 / 2000")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("table")).toContainText("v3")
  expect(writes).toHaveLength(1)
  expect(writes[0].path).toBe(
    `/api/v1/brands/${analysisIds.brand}/scenario-templates`,
  )
  expect(writes[0].body).toEqual({
    name: "品牌种草模板（演示）",
    scene: "seeding",
    structure: text,
  })
})

test("Creative type header filter and clear filter work on the complete authorized list", async ({
  page,
}) => {
  await setup(page)
  await page.goto("/scenarios")
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5)
  await page
    .getByRole("combobox", { name: "按创作类型筛选", exact: true })
    .click()
  await page.getByRole("option", { name: "测评", exact: true }).click()
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2)
  await expect(page.getByRole("table")).toContainText("品牌测评模板（演示）")
  await page.getByRole("button", { name: "清除筛选", exact: true }).click()
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5)
})

test("Editor can inspect a template using the keyboard but has no maintenance controls", async ({
  page,
}) => {
  const writes = await setup(page, true)
  await page.goto("/scenarios")
  const button = page.getByRole("button", {
    name: "查看模板详情：品牌种草模板（演示） v1",
    exact: true,
  })
  await button.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toContainText(structure)
  await expect(page.getByRole("dialog")).toContainText("当前角色只读")
  await expect(
    page.getByRole("button", { name: "存为新版本", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "新建模板", exact: true }),
  ).toHaveCount(0)
  expect(writes).toEqual([])
})

test("Saving an internal template explicitly creates a brand copy and shows API errors with request id", async ({
  page,
}) => {
  await setup(page)
  await page.goto("/scenarios")
  await page
    .getByRole("button", {
      name: "查看模板详情：内置种草模板（演示） v1",
      exact: true,
    })
    .click()
  await expect(page.getByRole("dialog")).toContainText("不修改全局模板")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "存为新版本", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "存为新版本", exact: true })
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 403,
          json: {
            error: {
              code: "FORBIDDEN",
              message: "当前角色没有操作权限",
              request_id: "template-save-fixture",
            },
          },
        })
      : route.fallback(),
  )
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toContainText("template-save-fixture")
  await expect(dialog.getByLabel("结构指引", { exact: true })).toHaveValue(
    structure,
  )
})

test("Empty, error and loading states keep the table visible", async ({
  page,
}) => {
  await setup(page)
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.goto("/scenarios")
  await expect(page.getByRole("table")).toContainText("还没有本品牌的模板")
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "FORBIDDEN",
          message: "没有权限",
          request_id: "template-list-fixture",
        },
      },
    }),
  )
  await page.reload()
  await expect(page.getByRole("table")).toContainText("template-list-fixture")
  await expect(
    page.getByRole("heading", { name: "没有权限查看这个页面", exact: true }),
  ).toBeVisible()
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/brands/*/scenario-templates", async (route) => {
    await pending
    await route.fulfill({ json: { items: [] } })
  })
  await page.reload()
  await expect(
    page.getByRole("table").locator('[data-slot="skeleton"]'),
  ).toBeVisible()
  release?.()
  await expect(page.getByRole("table")).toContainText("还没有本品牌的模板")
})

test("Unknown creative type strings retain labels and the original value when copied", async ({
  page,
}) => {
  const writes = await setup(page)
  const custom = {
    ...templates[1],
    scene: "custom-scene-fixture",
    name: "自定义类型模板（演示）",
  }
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { items: [custom] } })
      : route.fallback(),
  )
  await page.goto("/scenarios")
  await expect(page.getByRole("table")).toContainText(custom.scene)
  await page
    .getByRole("button", {
      name: `查看模板详情：${custom.name} v1`,
      exact: true,
    })
    .click()
  const drawer = page.getByRole("dialog")
  await expect(drawer).toContainText(custom.scene)
  await drawer.getByRole("button", { name: "存为新版本", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "存为新版本", exact: true })
  await expect(dialog.getByLabel("创作类型", { exact: true })).toHaveValue(
    custom.scene,
  )
  await expect(
    dialog.getByLabel("创作类型", { exact: true }).locator("option:checked"),
  ).toHaveText(custom.scene)
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body.scene).toBe(custom.scene)
})
