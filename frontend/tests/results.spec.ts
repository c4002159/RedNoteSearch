import { expect, type Page, test } from "@playwright/test"
import type { ConfirmedCopyPublic, ResultsSummary } from "../src/client"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

const copy: ConfirmedCopyPublic = {
  id: "33333333-3333-4333-8333-333333333333",
  brand_id: analysisIds.brand,
  task_id: null,
  version_id: "44444444-4444-4444-8444-444444444444",
  title: "周一通勤香气分享 🌿",
  scenario_name: "场景切入",
  scene: "seeding",
  promo_type: "product",
  promo_label: "日常香氛",
  confirmed_at: "2026-10-20T00:00:00Z",
  post_url: "https://www.xiaohongshu.com/explore/fixture",
  published_at: "2026-10-20T00:00:00Z",
  metrics_due_at: "2026-10-23T00:00:00Z",
  needs_metrics: true,
  latest_metric: {
    id: "reading-1",
    copy_id: "33333333-3333-4333-8333-333333333333",
    captured_at: "2026-10-21T00:00:00Z",
    likes: 18000,
    collects: 3420,
    comments: 412,
    approximate: true,
    source: "manual",
    created_at: "2026-10-21T00:00:00Z",
  },
}
const summary: ResultsSummary = {
  total_copies: 4,
  pending_count: 1,
  most_used: [{ scenario_name: "场景切入", scene: "seeding", count: 3 }],
  hottest: {
    enough_data: true,
    min_notes: 3,
    notes_with_metrics: 3,
    items: [
      {
        scenario_name: "场景切入",
        scene: "seeding",
        note_count: 3,
        average_engagement: 21000,
        approximate: true,
      },
    ],
  },
}

function envelope(status: number, message = "请求失败", errors?: unknown[]) {
  return {
    status,
    json: {
      error: {
        code: "VALIDATION_ERROR",
        message,
        details: errors ? { errors } : {},
        request_id: "req-results-fixture",
      },
    },
  }
}

async function setup(
  page: Page,
  options: {
    empty?: boolean
    unpublished?: boolean
    insufficient?: boolean
    editor?: boolean
    failure?: number
  } = {},
) {
  await mockAnalysis(page, options.editor)
  let current = {
    ...copy,
    ...(options.unpublished
      ? { published_at: null, post_url: null, needs_metrics: false }
      : {}),
  }
  const writes: { method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 1 } }),
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
  await page.route("**/api/v1/brands/*/results/summary", (route) =>
    route.fulfill({
      json: options.empty
        ? {
            ...summary,
            total_copies: 0,
            pending_count: 0,
            most_used: [],
            hottest: {
              enough_data: false,
              min_notes: 3,
              notes_with_metrics: 0,
              items: [],
            },
          }
        : options.insufficient
          ? {
              ...summary,
              hottest: {
                enough_data: false,
                min_notes: 3,
                notes_with_metrics: 2,
                items: [],
              },
            }
          : summary,
    }),
  )
  await page.route("**/api/v1/brands/*/confirmed-copies?*", (route) => {
    const url = new URL(route.request().url())
    queries.push(url)
    if (options.failure)
      return route.fulfill(
        envelope(options.failure, "RESULTS_SERVICE_UNAVAILABLE"),
      )
    const items = options.empty ? [] : [current]
    return route.fulfill({
      json: {
        items,
        total: items.length,
        page: Number(url.searchParams.get("page") ?? 1),
        page_size: 20,
      },
    })
  })
  await page.route("**/api/v1/confirmed-copies/*", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push({ method: route.request().method(), body })
    current = { ...current, ...body } as ConfirmedCopyPublic
    return route.fulfill({ json: current })
  })
  await page.route("**/api/v1/confirmed-copies/*/metrics", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push({ method: route.request().method(), body })
    const metric = {
      ...copy.latest_metric,
      ...body,
      id: "reading-new",
      captured_at: body.captured_at ?? "2026-11-02T00:00:00Z",
    }
    current = {
      ...current,
      latest_metric: metric as ConfirmedCopyPublic["latest_metric"],
      needs_metrics: false,
    }
    return route.fulfill({ status: 201, json: metric })
  })
  return { writes, queries }
}

test("Results list, search, pending tab and member access", async ({
  page,
}) => {
  const { queries } = await setup(page, { editor: true })
  await page.goto("/results")
  await expect(page).toHaveTitle("成绩记录 - RedNoteSearch")
  await expect(
    page.getByRole("cell", { name: /周一通勤香气分享/ }),
  ).toBeVisible()
  await expect(page.getByText("约1.8万", { exact: false })).toBeVisible()
  await expect(
    page.getByRole("cell", { name: /场景切入\s+种草/ }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "登记成绩", exact: true }),
  ).toBeVisible()
  await page.getByRole("tab", { name: "待补成绩（1）" }).click()
  await expect
    .poll(() => queries[queries.length - 1]?.searchParams.get("needs_metrics"))
    .toBe("true")
  await expect(
    page.getByText("发布满 3 天", { exact: false }).first(),
  ).toBeVisible()
  await page.getByRole("textbox", { name: "搜索文案标题" }).fill("周一")
  await page.getByRole("button", { name: "搜索", exact: true }).click()
  await expect
    .poll(() => queries[queries.length - 1]?.searchParams.get("q"))
    .toBe("周一")
  expect(queries.every((url) => url.pathname.includes(analysisIds.brand))).toBe(
    true,
  )
})

for (const pending of [false, true])
  test(`Results search empty state clears query and preserves pending=${pending}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await setup(page)
    const queries: URL[] = []
    await page.route("**/api/v1/brands/*/confirmed-copies?*", (route) => {
      const url = new URL(route.request().url())
      queries.push(url)
      const items = url.searchParams.get("q") ? [] : [copy]
      return route.fulfill({
        json: { items, total: items.length, page: 1, page_size: 20 },
      })
    })
    await page.goto("/results")
    await expect(
      page.getByRole("cell", { name: /周一通勤香气分享/ }),
    ).toBeVisible()
    if (pending) await page.getByRole("tab", { name: "待补成绩（1）" }).click()
    await page
      .getByRole("textbox", { name: "搜索文案标题" })
      .fill("  不存在的标题  ")
    await page.getByRole("button", { name: "搜索", exact: true }).click()
    await expect(
      page.getByText("没有找到匹配的文案", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText("换个关键词试试", { exact: true }),
    ).toBeVisible()
    await expect(page.getByText("暂无成绩记录", { exact: true })).toHaveCount(0)
    await expect(
      page.getByText("文案确认后会显示在这里，可逐篇登记发布信息和成绩。", {
        exact: true,
      }),
    ).toHaveCount(0)
    expect(queries[queries.length - 1]?.searchParams.get("q")).toBe(
      "不存在的标题",
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`search-empty-${pending}-1280.png`),
      fullPage: true,
      animations: "disabled",
    })
    const before = queries.length
    await page.getByRole("button", { name: "清除搜索", exact: true }).click()
    await expect(
      page.getByRole("textbox", { name: "搜索文案标题" }),
    ).toHaveValue("")
    await expect.poll(() => queries.length).toBeGreaterThan(before)
    expect(queries[queries.length - 1]?.searchParams.has("q")).toBe(false)
    expect(queries[queries.length - 1]?.searchParams.get("page")).toBe("1")
    expect(queries[queries.length - 1]?.searchParams.get("needs_metrics")).toBe(
      pending ? "true" : null,
    )
    await expect(
      page.getByRole("cell", { name: /周一通勤香气分享/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "清除搜索", exact: true }),
    ).toHaveCount(0)
  })

for (const forbidden of ["summary", "list", "both"])
  test(`Results ${forbidden} 403 renders exactly one permission card without content or pager`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await setup(page)
    if (forbidden !== "list")
      await page.route("**/api/v1/brands/*/results/summary", (route) =>
        route.fulfill(envelope(403)),
      )
    if (forbidden !== "summary")
      await page.route("**/api/v1/brands/*/confirmed-copies?*", (route) =>
        route.fulfill(envelope(403)),
      )
    await page.goto("/results")
    const card = page.getByRole("heading", {
      name: "没有权限查看这个页面",
      exact: true,
    })
    await expect(card).toBeVisible()
    await expect(card).toHaveCount(1)
    await expect(
      page.getByText("req-results-fixture", { exact: true }),
    ).toHaveCount(1)
    await expect(page.getByRole("region", { name: "成绩概览" })).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "已确认文案", exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole("table")).toHaveCount(0)
    await expect(page.getByRole("tablist", { name: "成绩范围" })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "上一页", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "下一页", exact: true }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`forbidden-${forbidden}-1280.png`),
      fullPage: true,
      animations: "disabled",
    })
  })

test("Results publication dialog validates, saves timezone and warns about short links", async ({
  page,
}) => {
  const { writes } = await setup(page, { unpublished: true })
  await page.goto("/results")
  await page.getByRole("button", { name: "登记发布信息", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("文案标题", { exact: true }).fill("")
  await dialog
    .getByLabel("帖子网址", { exact: true })
    .fill("https://example.invalid/note")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog.getByText("标题需为 1 到 200 个字")).toBeVisible()
  await expect(
    dialog.getByText("请输入小红书的安全网址", { exact: false }),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByLabel("文案标题", { exact: true }).fill("新的通勤标题 🌿")
  await dialog
    .getByLabel("帖子网址", { exact: true })
    .fill("https://xhslink.com/fixture")
  await dialog.getByLabel("发布时间", { exact: true }).fill("2026-10-21T12:00")
  await expect(
    dialog.getByText("短链接无法自动对上浏览器插件的读数，需要手动登记"),
  ).toBeVisible()
  await expect
    .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1")
  await page.screenshot({
    path: test.info().outputPath("publication-dialog.png"),
  })
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    method: "PATCH",
    body: { title: "新的通勤标题 🌿", post_url: "https://xhslink.com/fixture" },
  })
  expect(String(writes[0].body.published_at)).toMatch(/Z$/)
  await expect(
    page.getByRole("button", { name: "登记成绩", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "修改发布信息" }).click()
  await dialog.getByLabel("帖子网址", { exact: true }).fill("")
  await dialog.getByLabel("发布时间", { exact: true }).fill("")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes[1].body).toMatchObject({ post_url: null, published_at: null })
})

test("Results new reading is appended with manual source and field validation", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto("/results")
  await page.getByRole("button", { name: "登记成绩", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByText("每次保存都会新增一条读数", { exact: false }),
  ).toBeVisible()
  await dialog.getByLabel("点赞", { exact: true }).fill("-1")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(
    dialog.getByText("请输入 0 到 10 亿之间的整数").first(),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByLabel("点赞", { exact: true }).fill("25000")
  await dialog.getByLabel("收藏", { exact: true }).fill("100")
  await dialog.getByLabel("评论", { exact: true }).fill("0")
  await dialog.getByRole("checkbox", { name: "近似读数" }).check()
  await expect
    .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1")
  await page.screenshot({ path: test.info().outputPath("metric-dialog.png") })
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toEqual([
    {
      method: "POST",
      body: {
        likes: 25000,
        collects: 100,
        comments: 0,
        approximate: true,
        source: "manual",
      },
    },
  ])
  await expect(page.getByRole("cell", { name: /约2.5万/ })).toBeVisible()
})

test("Results insufficient data and empty list keep table without rankings", async ({
  page,
}) => {
  await setup(page, { empty: true })
  await page.goto("/results")
  await expect(page.getByText("数据不足", { exact: true })).toBeVisible()
  await expect(
    page.getByText("已有 0 篇文案有读数，至少需要 3 篇才显示排名。"),
  ).toBeVisible()
  await expect(page.getByRole("table")).toBeVisible()
  await expect(
    page.getByRole("cell").getByText("暂无成绩记录", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("样本很少，只能说明方向，不能说明哪个模板更好"),
  ).toBeVisible()
  await page.getByRole("tab", { name: "待补成绩（0）" }).click()
  await expect(
    page.getByRole("cell").getByText("暂无待补成绩", { exact: true }),
  ).toBeVisible()
})

test("Results below three readings never shows hottest ranking", async ({
  page,
}) => {
  await setup(page, { insufficient: true })
  await page.goto("/results")
  await expect(
    page.getByText("已有 2 篇文案有读数，至少需要 3 篇才显示排名。"),
  ).toBeVisible()
  await expect(page.getByText("平均互动", { exact: false })).toHaveCount(0)
})

test("Results forbidden and missing responses preserve session and request id", async ({
  page,
}) => {
  await setup(page, { failure: 403 })
  await page.goto("/results")
  await expect(
    page.getByRole("heading", { name: "没有权限查看这个页面" }),
  ).toBeVisible()
  await expect(page.getByText("req-results-fixture")).toBeVisible()
  await expect(page).toHaveURL(/\/results$/)
  await page.route("**/api/v1/brands/*/confirmed-copies?*", (route) =>
    route.fulfill(envelope(404)),
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "没有找到这个内容" }),
  ).toBeVisible()
})

test("Results server 422 displays Chinese field error and request id without losing values", async ({
  page,
}) => {
  await setup(page, { unpublished: true })
  await page.route("**/api/v1/confirmed-copies/*", (route) =>
    route.fulfill(
      envelope(422, "发布信息不符合要求", [
        {
          loc: ["body", "post_url"],
          msg: "网址格式不正确，请核对",
          type: "value_error",
        },
      ]),
    ),
  )
  await page.goto("/results")
  await page.getByRole("button", { name: "登记发布信息", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog
    .getByLabel("帖子网址", { exact: true })
    .fill("https://xhslink.com/fixture")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog.locator("#result-post_url-error")).toHaveText(
    "网址格式不正确，请核对",
  )
  await expect(dialog.getByText("req-results-fixture")).toBeVisible()
  await expect(dialog.getByLabel("帖子网址", { exact: true })).toHaveValue(
    "https://xhslink.com/fixture",
  )
  await expect(
    dialog.getByText("VALIDATION_ERROR", { exact: false }),
  ).toHaveCount(0)
})

test("Results loading then failure shows Chinese retry and request id", async ({
  page,
}) => {
  await setup(page)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  await page.route("**/api/v1/brands/*/confirmed-copies?*", async (route) => {
    requests++
    await gate
    return route.fulfill(envelope(500, "RESULTS_SERVICE_UNAVAILABLE"))
  })
  await page.goto("/results")
  await expect(page.getByLabel("正在加载成绩记录")).toBeVisible()
  release()
  await expect(page.getByText("读取或保存失败，请重试")).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByText("req-results-fixture")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible()
  expect(requests).toBe(4)
  await expect(page.getByText("RESULTS_SERVICE_UNAVAILABLE")).toHaveCount(0)
})

for (const width of [1440, 1280])
  test(`Results visual ${width} has no horizontal overflow or console errors`, async ({
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
    await page.goto("/results")
    await expect(
      page.getByRole("cell", { name: /周一通勤香气分享/ }),
    ).toBeVisible()
    await expect(page.getByText("含近似读数")).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "全部", exact: true }),
    ).toHaveAttribute("aria-selected", "true")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`results-${width}.png`),
      fullPage: true,
    })
    expect(errors).toEqual([])
  })
