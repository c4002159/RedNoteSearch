import { expect, type Page, test } from "@playwright/test"
import type { ToneSuggestions } from "../src/client"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const productId = "33333333-3333-4333-8333-333333333333"
const data: ToneSuggestions = {
  history: [
    {
      tone: "亲切自然",
      source: "task",
      count: 2,
      last_used_at: "2026-11-02T01:00:00Z",
    },
    { tone: "从容叙述", source: "preset", count: null, last_used_at: null },
  ],
  template: [{ tone: "轻松克制", count: 7, sample_count: 2 }],
  results: {
    enough_data: true,
    notes_with_metrics: 4,
    min_notes: 3,
    items: [
      {
        tone: "清晰直接",
        note_count: 4,
        average_engagement: 24000,
        approximate: true,
      },
    ],
  },
}
const empty: ToneSuggestions = {
  history: [],
  template: [],
  results: {
    enough_data: false,
    notes_with_metrics: 0,
    min_notes: 3,
    items: [],
  },
}
const generated = {
  items: [{ tone: "温柔叙述", reason: "沿用品牌的克制表达方式" }],
  model: "fixture",
  prompt_version: "tone-v1",
}
function failure(status: number, code = "INTERNAL_ERROR") {
  return {
    status,
    json: {
      error: {
        code,
        message: "RAW_PROVIDER_ERROR",
        request_id: "req-tone-fixture",
        details: {},
      },
    },
  }
}
async function setup(
  page: Page,
  options: {
    value?: ToneSuggestions
    getError?: number
    modelError?: number
    modelCode?: string
    loading?: Promise<void>
    generating?: Promise<void>
    emptyModel?: boolean
    modelBatches?: (typeof generated.items)[]
  } = {},
) {
  await mockAnalysis(page, true)
  const reads: URL[] = [],
    writes: Record<string, unknown>[] = []
  let getError = options.getError
  await page.route("**/api/v1/brands/*/products?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: productId,
            brand_id: analysisIds.brand,
            name: "日常香氛",
            category: "perfume",
            product_line: "日常系列",
            notes: {},
            selling_points: [],
            restricted_claims: [],
            status: "active",
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      },
    }),
  )
  await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) =>
    route.fulfill({
      json: {
        items: [{ is_current: true, index_status: "ready" }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    }),
  )
  await page.route("**/api/v1/brands/*/style-presets", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route("**/api/v1/brands/*/creative-types", (route) =>
    route.fulfill({
      json: {
        items: [
          { key: "seeding", name: "种草", builtin: true, template_count: 1 },
          {
            key: "brand_custom",
            name: "品牌随笔",
            builtin: false,
            template_count: 1,
          },
        ],
      },
    }),
  )
  await page.route("**/api/v1/scenarios", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "scene-one",
            scene: "seeding",
            name: "场景切入",
            brand_id: null,
            structure: "生活场景",
            template_version: 1,
          },
          {
            id: "scene-two",
            scene: "brand_custom",
            name: "日常随笔",
            brand_id: analysisIds.brand,
            structure: "日常表达",
            template_version: 1,
          },
        ],
      },
    }),
  )
  await page.route(/\/tone-suggestions(?:\?.*)?$/, async (route) => {
    reads.push(new URL(route.request().url()))
    if (options.loading) await options.loading
    return route.fulfill(
      getError ? failure(getError) : { json: options.value ?? data },
    )
  })
  await page.route(
    "**/api/v1/brands/*/tone-suggestions/generate",
    async (route) => {
      writes.push(route.request().postDataJSON())
      if (options.generating) await options.generating
      return route.fulfill(
        options.modelError
          ? failure(options.modelError, options.modelCode)
          : {
              json: options.emptyModel
                ? { ...generated, items: [] }
                : {
                    ...generated,
                    items:
                      options.modelBatches?.[writes.length - 1] ??
                      generated.items,
                  },
            },
      )
    },
  )
  return {
    reads,
    writes,
    recover: () => {
      getError = undefined
    },
  }
}
async function open(page: Page) {
  await page.goto("/generate")
  await page.getByRole("button", { name: "推荐语气", exact: true }).click()
  return page.getByRole("dialog", { name: "推荐语气", exact: true })
}

test("Tone dialog groups sources and fills editable tone without auto generation", async ({
  page,
}) => {
  const { writes } = await setup(page)
  const dialog = await open(page)
  await expect(
    dialog.getByRole("region", { name: "我们用过的", exact: true }),
  ).toBeVisible()
  await expect(dialog.getByText("用过 2 次，最近 11-02")).toBeVisible()
  await expect(dialog.getByText("来自 2 个爆款样本")).toBeVisible()
  await expect(dialog.getByText("4 篇，平均互动约2.4万")).toBeVisible()
  await expect(dialog.getByText("场景只影响", { exact: false })).toBeVisible()
  await expect(
    dialog.getByText("样本很少，只能说明方向，不能说明哪种语气更好。"),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog
    .getByRole("button", { name: "使用 亲切自然", exact: true })
    .click()
  await expect(dialog).toBeHidden()
  const input = page.getByLabel("语气", { exact: true })
  await expect(input).toHaveValue("亲切自然")
  await input.fill("亲切自然，少用感叹")
  await expect(input).toHaveValue("亲切自然，少用感叹")
})

test("Tone preset never invents counts or dates and exact engagement has no approximate marker", async ({
  page,
}) => {
  await setup(page, {
    value: {
      ...data,
      results: {
        ...data.results,
        items: [
          {
            ...data.results.items[0],
            average_engagement: 300,
            approximate: false,
          },
        ],
      },
    },
  })
  const dialog = await open(page)
  const preset = dialog
    .getByRole("button", { name: "使用 从容叙述", exact: true })
    .locator("..")
  await expect(preset).toContainText("来自风格预设")
  await expect(preset).toContainText("品牌通用")
  await expect(preset).not.toContainText(/用过|最近|null/)
  await expect(dialog.getByText("4 篇，平均互动300")).toBeVisible()
})

for (const group of ["history", "template", "results"] as const)
  test(`Tone ${group} empty state preserves other groups`, async ({ page }) => {
    const value = {
      ...data,
      [group]: group === "results" ? { ...data.results, items: [] } : [],
    }
    await setup(page, { value })
    const dialog = await open(page)
    const expected = {
      history: "暂无任务记录或风格预设中的语气",
      template: "暂无爆款模板语气",
      results: "暂无可归因的成绩语气",
    }
    await expect(dialog.getByText(expected[group])).toBeVisible()
    await expect(
      dialog.getByText("还没有可推荐的语气，可以先用模型建议"),
    ).toHaveCount(0)
  })

test("Tone all-empty and insufficient data do not rank suggestions", async ({
  page,
}) => {
  await setup(page, {
    value: { ...empty, results: { ...empty.results, notes_with_metrics: 2 } },
  })
  const dialog = await open(page)
  await expect(
    dialog.getByText("还没有可推荐的语气，可以先用模型建议"),
  ).toBeVisible()
  await expect(
    dialog.getByText("数据不足，至少需要 3 篇有读数的文案"),
  ).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^使用 / })).toHaveCount(0)
})

test("Tone requests selected scene and primary product and prevents duplicate model calls", async ({
  page,
}) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fixture = await setup(page, { generating: gate })
  let dialog = await open(page)
  await expect(dialog.getByText("亲切自然", { exact: true })).toBeVisible()
  expect(fixture.reads[0].searchParams.has("scene")).toBe(false)
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "关闭", exact: true })
    .click()
  await page.getByRole("combobox", { name: "选择商品", exact: true }).click()
  await page.getByRole("option", { name: "日常香氛", exact: true }).click()
  await page
    .getByRole("radiogroup", { name: "场景", exact: true })
    .getByText("品牌随笔", { exact: true })
    .click()
  await page.getByRole("button", { name: "推荐语气", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "推荐语气", exact: true })
  await expect
    .poll(() =>
      fixture.reads[fixture.reads.length - 1]?.searchParams.get("scene"),
    )
    .toBe("brand_custom")
  await dialog
    .getByRole("button", { name: "让模型再想几个", exact: true })
    .click()
  await expect(
    dialog.getByRole("button", { name: "正在生成建议…", exact: true }),
  ).toBeDisabled()
  await expect(dialog.getByRole("status")).toHaveText("正在生成建议…")
  expect(fixture.writes).toEqual([
    {
      count: 5,
      scene: "brand_custom",
      product_id: productId,
      exclude: ["亲切自然", "从容叙述", "轻松克制", "清晰直接"],
    },
  ])
  expect(
    fixture.reads.every((url) => url.pathname.includes(analysisIds.brand)),
  ).toBe(true)
  release()
  await expect(dialog.getByText("模型建议，不是事实")).toBeVisible()
  await expect(dialog.getByText("沿用品牌的克制表达方式")).toBeVisible()
  await dialog
    .getByRole("button", { name: "使用 温柔叙述", exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel("语气", { exact: true })).toHaveValue("温柔叙述")
})

test("Tone activity request omits stale product and unspecified scene", async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.goto("/generate")
  await page.getByRole("combobox", { name: "选择商品", exact: true }).click()
  await page.getByRole("option", { name: "日常香氛", exact: true }).click()
  await page.getByRole("radio", { name: "活动推广", exact: true }).click()
  await page.getByRole("button", { name: "推荐语气", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "让模型再想几个", exact: true })
    .click()
  await expect(page.getByText("沿用品牌的克制表达方式")).toBeVisible()
  expect(fixture.writes).toEqual([
    { count: 5, exclude: ["亲切自然", "从容叙述", "轻松克制", "清晰直接"] },
  ])
})

for (const [status, code, text] of [
  [503, "MODEL_UNAVAILABLE", "模型暂时不可用，稍后再试"],
  [422, "TONE_NO_VALID_SUGGESTIONS", "这次没有得到可用的建议，请稍后再试"],
  [422, "TONE_INVALID_MODEL_OUTPUT", "这次没有得到可用的建议，请稍后再试"],
] as const)
  test(`Tone model ${code} displays Chinese error and request id`, async ({
    page,
  }) => {
    await setup(page, { modelError: status, modelCode: code })
    const dialog = await open(page)
    await dialog
      .getByRole("button", { name: "让模型再想几个", exact: true })
      .click()
    await expect(dialog.getByText(text)).toBeVisible()
    await expect(dialog.getByText("req-tone-fixture")).toBeVisible()
    await expect(dialog.getByText("RAW_PROVIDER_ERROR")).toHaveCount(0)
    await expect(
      dialog.getByRole("button", { name: "让模型再想几个", exact: true }),
    ).toBeEnabled()
  })

test("Tone loading, generic query failure and retry keep workbench editable", async ({
  page,
}) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fixture = await setup(page, { getError: 500, loading: gate })
  const dialog = await open(page)
  await expect(dialog.getByLabel("正在加载推荐语气")).toBeVisible()
  release()
  await expect(dialog.getByText("语气建议读取失败，请重试。")).toBeVisible({
    timeout: 15000,
  })
  await expect(dialog.getByText("req-tone-fixture")).toBeVisible()
  fixture.recover()
  await dialog.getByRole("button", { name: "重试", exact: true }).click()
  await expect(dialog.getByText("亲切自然", { exact: true })).toBeVisible()
})

test("Tone deduplication matches NFKC, casefold, whitespace and Unicode punctuation within each source", async ({
  page,
}) => {
  const tones = [
    " ＳＴＲＡＳＳＥ！ ",
    "straße",
    "Stra  sse",
    "Ος",
    "οσ",
    "Ꭰ",
    "ꭰ",
    "轻松、 自然",
    "轻松自然",
  ]
  await setup(page, {
    value: {
      history: tones.map((tone) => ({ ...data.history[0], tone })),
      template: tones.map((tone) => ({ ...data.template[0], tone })),
      results: {
        ...data.results,
        items: tones.map((tone) => ({ ...data.results.items[0], tone })),
      },
    },
  })
  const dialog = await open(page)
  for (const title of [
    "我们用过的",
    "爆款模板里的语气",
    "成绩较好的文案用过的语气",
  ]) {
    const group = dialog.getByRole("region", { name: title, exact: true })
    await expect(group.getByRole("button", { name: /^使用 / })).toHaveCount(4)
    await expect(group.getByText("共 4 条", { exact: true })).toBeVisible()
  }
  await expect(dialog.getByRole("button", { name: /^使用 / })).toHaveCount(12)
})

test("Tone exclude includes all displayed sources and previous model batches, bounded at 30 entries and 40 code points", async ({
  page,
}) => {
  const long = "长".repeat(45)
  const firstBatch = [
    { tone: "新语气", reason: "新建议" },
    { tone: "新、 语气！", reason: "重复建议" },
  ]
  const fixture = await setup(page, {
    value: { ...empty, history: [{ ...data.history[0], tone: long }] },
    modelBatches: [firstBatch, [{ tone: "另一语气", reason: "另一建议" }]],
  })
  const dialog = await open(page)
  await expect(
    dialog.getByRole("button", { name: `使用 ${long}`, exact: true }),
  ).toBeVisible()
  const generate = dialog.getByRole("button", {
    name: "让模型再想几个",
    exact: true,
  })
  await generate.click()
  const model = dialog.getByRole("region", { name: "模型建议", exact: true })
  await expect(model.getByRole("button", { name: /^使用 / })).toHaveCount(1)
  await expect(model.getByText("共 1 条", { exact: true })).toBeVisible()
  expect(fixture.writes[0]).toEqual({ count: 5, exclude: ["长".repeat(40)] })
  await generate.click()
  await expect(model.getByText("另一语气", { exact: true })).toBeVisible()
  expect(fixture.writes[1]).toEqual({
    count: 5,
    exclude: ["长".repeat(40), "新语气"],
  })
  await generate.click()
  await expect.poll(() => fixture.writes.length).toBe(3)
  expect(fixture.writes[2]).toEqual({
    count: 5,
    exclude: ["长".repeat(40), "新语气", "另一语气"],
  })
})

test("Tone exclude never sends more than 30 already displayed tones", async ({
  page,
}) => {
  const fixture = await setup(page, {
    value: {
      ...empty,
      history: Array.from({ length: 32 }, (_, i) => ({
        ...data.history[0],
        tone: `语气${i}`,
      })),
    },
  })
  const dialog = await open(page)
  await expect(dialog.getByRole("button", { name: /^使用 / })).toHaveCount(32)
  await dialog
    .getByRole("button", { name: "让模型再想几个", exact: true })
    .click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.writes[0]).toEqual({
    count: 5,
    exclude: Array.from({ length: 30 }, (_, i) => `语气${i + 2}`),
  })
})

for (const width of [1440, 1280])
  test(`Tone visual ${width} no overflow or console errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(String(response.status()))
    })
    await page.setViewportSize({ width, height: 900 })
    await setup(page)
    const dialog = await open(page)
    await expect(dialog.getByText("来自 2 个爆款样本")).toBeVisible()
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1")
    await page.screenshot({
      path: test.info().outputPath(`tone-${width}-sources.png`),
    })
    await dialog
      .getByRole("button", { name: "让模型再想几个", exact: true })
      .click()
    await expect(dialog.getByText("沿用品牌的克制表达方式")).toBeVisible()
    await dialog
      .getByRole("region", { name: "模型建议", exact: true })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1")
    await page.mouse.move(5, 65)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`tone-${width}.png`) })
    expect(errors).toEqual([])
  })
