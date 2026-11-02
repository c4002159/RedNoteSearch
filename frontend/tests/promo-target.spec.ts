import { expect, type Page, test } from "@playwright/test"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = analysisIds.brand
const task = "99999999-9999-4999-8999-999999999999"
const products = Array.from({ length: 6 }, (_, index) => ({
  id: `33333333-3333-4333-8333-33333333333${index}`,
  brand_id: brand,
  name: `香氛商品${index + 1}`,
  category: "perfume",
  product_line: "日常香氛系列",
  notes: {},
  selling_points: [],
  restricted_claims: [],
  status: "active",
}))
const types = [
  { key: "seeding", name: "种草", builtin: true, template_count: 2 },
  { key: "review", name: "测评", builtin: true, template_count: 0 },
  { key: "brand_custom", name: "品牌随笔", builtin: false, template_count: 1 },
]
const scenarios = [
  {
    id: "44444444-4444-4444-8444-444444444440",
    scene: "seeding",
    name: "生活场景",
    template_version: 1,
    structure: "场景与感受",
    brand_id: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444441",
    scene: "seeding",
    name: "通勤分享",
    template_version: 2,
    structure: "通勤与体验",
    brand_id: brand,
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    scene: "brand_custom",
    name: "日常片段",
    template_version: 1,
    structure: "生活片段",
    brand_id: brand,
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    scene: "review",
    name: "其他品牌模板",
    template_version: 1,
    structure: "其他内容",
    brand_id: "55555555-5555-4555-8555-555555555555",
  },
]
function failure(status: number) {
  return {
    status,
    json: {
      error: {
        code: "INTERNAL_ERROR",
        message: "UPSTREAM_FAILURE",
        request_id: "req-promo-fixture",
        details: {},
      },
    },
  }
}
async function setup(
  page: Page,
  options: {
    emptyProducts?: boolean
    emptyTemplates?: boolean
    emptyTypes?: boolean
    failedTypes?: number
    loading?: Promise<void>
  } = {},
) {
  await mockAnalysis(page)
  const writes: Record<string, unknown>[] = []
  let fail = options.failedTypes
  await page.route("**/api/v1/brands/*/products?*", async (route) => {
    if (options.loading) await options.loading
    return route.fulfill({
      json: {
        items: options.emptyProducts ? [] : products,
        total: products.length,
        page: 1,
        page_size: 100,
      },
    })
  })
  await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "document", is_current: true, index_status: "ready" }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    }),
  )
  await page.route("**/api/v1/scenarios", (route) =>
    route.fulfill({ json: { items: options.emptyTemplates ? [] : scenarios } }),
  )
  await page.route("**/api/v1/brands/*/creative-types", async (route) => {
    if (options.loading) await options.loading
    return fail
      ? route.fulfill(failure(fail))
      : route.fulfill({ json: { items: options.emptyTypes ? [] : types } })
  })
  await page.route("**/api/v1/brands/*/style-presets", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route("**/api/v1/tasks", async (route) => {
    writes.push(route.request().postDataJSON())
    return route.fulfill({ status: 201, json: { id: task } })
  })
  await page.route(`**/api/v1/tasks/${task}`, (route) =>
    route.fulfill({
      json: {
        id: task,
        brand_id: brand,
        product_name: "香氛任务",
        scenario_name: "生活场景",
        flow_status: "queued",
        progress: null,
        last_error: null,
        latest_version_id: null,
      },
    }),
  )
  await page.route(`**/api/v1/tasks/${task}/materials`, (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  return {
    writes,
    recover: () => {
      fail = undefined
    },
  }
}
async function select(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function scene(page: Page, name = "种草") {
  await page
    .getByRole("radiogroup", { name: "场景", exact: true })
    .getByText(name, { exact: true })
    .click()
  await expect(
    page
      .getByRole("radiogroup", { name: "场景", exact: true })
      .getByRole("radio", { name: new RegExp(name) }),
  ).toBeChecked()
}
const create = (page: Page) =>
  page.getByRole("button", { name: "仅创建，稍后添加资料", exact: true })

test("Custom scene requires both description and an explicit closest template, then preserves the appended brief in task details", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await scene(page)
  await scene(page, "自定义")
  const description = page.getByRole("textbox", { name: /场景说明/ })
  const generate = page.getByRole("button", {
    name: "创建并开始生成",
    exact: true,
  })
  await expect(create(page)).toBeDisabled()
  await expect(generate).toBeDisabled()
  await expect(
    page
      .locator("form")
      .getByRole("link", { name: "创作类型管理", exact: true }),
  ).toHaveAttribute("href", "/creative-types")
  await description.fill("   ")
  await select(page, "最接近的场景模板（必选）", "通勤分享 v2")
  await expect(create(page)).toBeDisabled()
  await expect(generate).toBeDisabled()
  await description.fill("周末好友聚会")
  await expect(create(page)).toBeEnabled()
  await expect(generate).toBeEnabled()
  await select(page, "最接近的场景模板（必选）", "请选择模板")
  await expect(create(page)).toBeDisabled()
  await expect(generate).toBeDisabled()
  expect(writes).toHaveLength(0)
  await select(page, "最接近的场景模板（必选）", "通勤分享 v2")
  await description.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("custom-scene.png") })
  await page.getByRole("textbox", { name: /创作要求/ }).fill("保留轻松的表达")
  await create(page).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({
    scenario_id: scenarios[1].id,
    brief: "保留轻松的表达\n场景说明：周末好友聚会",
    promo_type: "product",
    product_id: products[0].id,
  })
  expect(writes[0]).not.toHaveProperty("scene_description")
  expect(writes[0]).not.toHaveProperty("custom_scene")
  await page.route(`**/api/v1/tasks/${task}`, (route) =>
    route.fulfill({
      json: {
        ...writes[0],
        id: task,
        scenario_name: scenarios[1].name,
        scenario_version: 2,
        product_name: products[0].name,
        flow_status: "queued",
        progress: null,
        last_error: null,
        latest_version_id: null,
        created_at: "2026-11-03T01:00:00Z",
      },
    }),
  )
  await page.route(`**/api/v1/tasks/${task}/versions*`, (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.goto(`/tasks/${task}`)
  await expect(
    page.locator("dd").filter({ hasText: "场景说明：周末好友聚会" }),
  ).toHaveText("保留轻松的表达\n场景说明：周末好友聚会")
})

test("Custom scene caps description at 50 code points and checks the combined brief limit; normal scenes omit the custom description", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await scene(page, "自定义")
  await select(page, "最接近的场景模板（必选）", "生活场景 v1")
  const description = page.getByRole("textbox", { name: /场景说明/ })
  await description.fill("😀".repeat(51))
  await expect(description).toHaveValue("😀".repeat(50))
  await expect(
    page.getByText("50 / 50 字（必填）", { exact: true }),
  ).toBeVisible()
  await expect(create(page)).toBeEnabled()
  const brief = page.getByRole("textbox", { name: /创作要求/ })
  await brief.fill("要".repeat(1990))
  await expect(create(page)).toBeDisabled()
  await brief.fill("原有创作要求")
  await scene(page)
  await expect(description).toHaveCount(0)
  await expect(create(page)).toBeEnabled()
  await create(page).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].brief).toBe("原有创作要求")
  expect(writes[0].scenario_id).toBe(scenarios[0].id)
})

test("Promo single product submits only its own fields and shows real metadata", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await expect(
    page.getByText("类目：香水 · 产品线：日常香氛系列"),
  ).toBeVisible()
  await scene(page)
  await create(page).click()
  await expect(page).toHaveURL(new RegExp(`task=${task}`))
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    brand_id: brand,
    promo_type: "product",
    product_id: products[0].id,
    scenario_id: scenarios[0].id,
  })
  expect(writes[0]).not.toHaveProperty("extra_product_ids")
  expect(writes[0]).not.toHaveProperty("activity")
})

test("Promo multi product requires extras, caps four and removes newly selected primary", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await page.getByRole("radio", { name: "多品组合", exact: true }).click()
  await select(page, "主推商品", "香氛商品1")
  await scene(page)
  await expect(create(page)).toBeDisabled()
  await page
    .getByText("搭配商品（已选 0 / 4，至少 1 个）", { exact: true })
    .click()
  await expect(
    page.getByRole("checkbox", { name: "香氛商品1", exact: true }),
  ).toBeDisabled()
  for (const number of [2, 3, 4, 5])
    await page
      .getByRole("checkbox", { name: `香氛商品${number}`, exact: true })
      .check()
  await expect(
    page.getByRole("checkbox", { name: "香氛商品6", exact: true }),
  ).toBeDisabled()
  await select(page, "主推商品", "香氛商品2")
  await expect(
    page.getByRole("checkbox", { name: "香氛商品2", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("checkbox", { name: "香氛商品2", exact: true }),
  ).not.toBeChecked()
  await expect(
    page.getByText("搭配商品（已选 3 / 4，至少 1 个）", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "清除已选", exact: true }).click()
  await expect(create(page)).toBeDisabled()
  await page.getByRole("checkbox", { name: "香氛商品3", exact: true }).check()
  await create(page).click()
  await expect(page).toHaveURL(new RegExp(`task=${task}`))
  expect(writes[0]).toMatchObject({
    promo_type: "multi_product",
    product_id: products[1].id,
    extra_product_ids: [products[2].id],
  })
  expect(writes[0]).not.toHaveProperty("activity")
})

test("Promo activity adds and removes perks and does not send product fields", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await scene(page)
  await page.getByRole("radio", { name: "活动推广", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "选择商品" })).toHaveCount(0)
  await expect(create(page)).toBeDisabled()
  await page.getByLabel("活动名称", { exact: true }).fill("周末香氛分享")
  await page
    .getByLabel("活动说明（选填）", { exact: true })
    .fill("介绍活动参与方式")
  const perks = page.getByLabel("活动福利", { exact: true })
  for (const text of ["到店体验", "领取试香", "限时礼遇"]) {
    await perks.fill(text)
    await perks.press("Enter")
  }
  await page
    .getByRole("button", { name: "删除 活动福利 2", exact: true })
    .click()
  await expect(page.getByText("领取试香", { exact: true })).toHaveCount(0)
  await create(page).click()
  await expect(page).toHaveURL(new RegExp(`task=${task}`))
  expect(writes[0]).toMatchObject({
    promo_type: "activity",
    activity: {
      name: "周末香氛分享",
      detail: "介绍活动参与方式",
      perks: ["到店体验", "限时礼遇"],
    },
  })
  expect(writes[0]).not.toHaveProperty("product_id")
  expect(writes[0]).not.toHaveProperty("extra_product_ids")
})

test("Promo activity limits name detail perk length and ten perks", async ({
  page,
}) => {
  await setup(page)
  await page.goto("/generate")
  await page.getByRole("radio", { name: "活动推广", exact: true }).click()
  await scene(page)
  const name = page.getByLabel("活动名称", { exact: true }),
    detail = page.getByLabel("活动说明（选填）", { exact: true }),
    perks = page.getByLabel("活动福利", { exact: true })
  await name.fill("名".repeat(101))
  await expect(create(page)).toBeDisabled()
  await name.fill("活动")
  await detail.fill("说".repeat(1001))
  await expect(create(page)).toBeDisabled()
  await detail.fill("")
  await perks.fill("福".repeat(201))
  await perks.press("Enter")
  await expect(create(page)).toBeDisabled()
  await page
    .getByRole("button", { name: "删除 活动福利 1", exact: true })
    .click()
  for (let index = 0; index < 10; index++) {
    await perks.fill(`福利${index}`)
    await perks.press("Enter")
  }
  await expect(perks).toBeDisabled()
  await expect(create(page)).toBeEnabled()
})

test("Promo dynamic cards select multiple templates of one type and exclude other brands", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await expect(page.getByRole("radio", { name: /测评/ })).toBeDisabled()
  await scene(page, "品牌随笔")
  await expect(
    page.getByRole("combobox", { name: "场景模板", exact: true }),
  ).toHaveCount(0)
  await scene(page)
  await select(page, "场景模板", "通勤分享 v2")
  await expect(page.getByRole("radio", { name: /种草/ })).toBeChecked()
  await create(page).click()
  await expect(page).toHaveURL(new RegExp(`task=${task}`))
  expect(writes[0].scenario_id).toBe(scenarios[1].id)
})

test("Promo loading and empty products allow activity without inventing data", async ({
  page,
}) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await setup(page, { emptyProducts: true, loading: gate })
  await page.goto("/generate")
  await expect(page.getByLabel("正在加载可选商品")).toBeVisible()
  await expect(page.getByLabel("正在加载创作场景")).toBeVisible()
  release()
  await expect(
    page.getByText("当前品牌没有可选商品", { exact: false }),
  ).toBeVisible()
  await expect(create(page)).toBeDisabled()
  await page.getByRole("radio", { name: "活动推广", exact: true }).click()
  await page.getByLabel("活动名称", { exact: true }).fill("品牌活动")
  await scene(page)
  await expect(create(page)).toBeEnabled()
})

test("Promo empty templates and creative types explain why creation is unavailable", async ({
  page,
}) => {
  await setup(page, { emptyTemplates: true, emptyTypes: true })
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await expect(
    page.getByText("当前品牌暂无创作类型，请联系管理员添加。"),
  ).toBeVisible()
  await expect(
    page.getByText("当前品牌还没有可用场景模板，请联系管理员添加。"),
  ).toBeVisible()
  await expect(create(page)).toBeDisabled()
})

test("Promo failed creative type request shows Chinese request id and recovers on retry", async ({
  page,
}) => {
  const fixture = await setup(page, { failedTypes: 503 })
  await page.goto("/generate")
  await expect(
    page.getByText("推广对象或创作场景加载失败，请重试。"),
  ).toBeVisible({ timeout: 15000 })
  await expect(page.getByText("req-promo-fixture")).toBeVisible()
  await expect(page.getByText("UPSTREAM_FAILURE")).toHaveCount(0)
  fixture.recover()
  await page.getByRole("button", { name: "重试", exact: true }).click()
  await expect(page.getByRole("radio", { name: /品牌随笔/ })).toBeVisible()
})

test("Promo rejected task preserves promotion selection and displays request id", async ({
  page,
}) => {
  await setup(page)
  await page.route("**/api/v1/tasks", (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: {
          code: "VALIDATION_ERROR",
          message: "推广对象已变化，请重新选择",
          request_id: "req-promo-create",
          details: {},
        },
      },
    }),
  )
  await page.goto("/generate")
  await select(page, "选择商品", "香氛商品1")
  await scene(page)
  await create(page).click()
  await expect(page.getByText("推广对象已变化，请重新选择")).toBeVisible()
  await expect(page.getByText("req-promo-create")).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "选择商品", exact: true }),
  ).toContainText("香氛商品1")
  await expect(page.getByRole("radio", { name: /种草/ })).toBeChecked()
  await expect(page.getByText("VALIDATION_ERROR")).toHaveCount(0)
})

test("Promo forbidden creative type request does not log out", async ({
  page,
}) => {
  await setup(page, { failedTypes: 403 })
  await page.goto("/generate")
  await expect(
    page.getByRole("heading", { name: "没有权限查看这个页面" }),
  ).toBeVisible()
  await expect(page.getByText("req-promo-fixture")).toBeVisible()
  await expect(page).toHaveURL(/\/generate$/)
})

for (const width of [1440, 1280])
  test(`Promo visual ${width} three modes have no overflow or console errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })
    await page.setViewportSize({ width, height: 900 })
    await setup(page)
    await page.goto("/generate")
    await select(page, "选择商品", "香氛商品1")
    await scene(page)
    for (const mode of ["单品", "多品组合", "活动推广"]) {
      await page.getByRole("radio", { name: mode, exact: true }).click()
      await expect(
        page.getByRole("radio", { name: mode, exact: true }),
      ).toHaveAttribute("aria-checked", "true")
      if (mode === "多品组合") {
        await page
          .getByText("搭配商品（已选 0 / 4，至少 1 个）", { exact: true })
          .click()
        await page
          .getByRole("checkbox", { name: "香氛商品2", exact: true })
          .check()
      }
      if (mode === "活动推广") {
        await page.getByLabel("活动名称", { exact: true }).fill("周末香氛分享")
        const perks = page.getByLabel("活动福利", { exact: true })
        await perks.fill("到店体验")
        await perks.press("Enter")
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.mouse.move(5, 65)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: test.info().outputPath(`promo-${width}-${mode}.png`),
      })
    }
    expect(errors).toEqual([])
  })
