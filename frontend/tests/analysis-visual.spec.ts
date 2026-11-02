import { expect, test } from "@playwright/test"
import {
  analysisIds as ids,
  mockAnalysis,
  visualRun,
} from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

for (const width of [1433, 1024, 720]) {
  test(`Evaluation and viral pages keep tables and layout at ${width}px`, async ({
    page,
  }, info) => {
    await mockAnalysis(page)
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    for (const [url, title] of [
      ["/evaluation/datasets", "评测集"],
      [`/evaluation/datasets/${ids.dataset}`, "香氛表达（演示）"],
      ["/evaluation/runs", "评测运行与报告"],
      [`/evaluation/runs/${ids.run}`, "评测运行详情"],
      ["/viral-samples", "爆款结构分析"],
      [`/viral-samples/${ids.sample}`, "样本详情"],
      [`/viral-patterns/${ids.pattern}`, "结构详情"],
    ]) {
      await page.goto(url)
      await expect(
        page.getByRole("heading", { level: 1, name: title, exact: true }),
      ).toBeVisible()
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true)
      await page.screenshot({
        path: info.outputPath(`${url.split("/")[1]}-${title}-${width}.png`),
        fullPage: true,
      })
    }
    expect(errors).toEqual([])
  })
}

test("Dataset JSON and result details use dialogs; rubric scores send the result id", async ({
  page,
}) => {
  const writes = await mockAnalysis(page)
  await page.goto(`/evaluation/datasets/${ids.dataset}`)
  await page.getByRole("button", { name: "查看 JSON", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("香氛表达（演示）")
  await page.screenshot({ path: test.info().outputPath("case-json.png") })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click()
  await page.goto(`/evaluation/runs/${ids.run}`)
  await page.getByRole("button", { name: "查看详情", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("微风与香气")
  await page.screenshot({ path: test.info().outputPath("result-detail.png") })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "人工评分", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toContainText("人工确认，不是系统验证")
  await page.screenshot({ path: test.info().outputPath("rating.png") })
  await page.getByRole("radio", { name: "3", exact: true }).check()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(writes.find((w) => w.path.endsWith("/ratings"))?.body.result_id).toBe(
    ids.result,
  )
  await expect(
    page.getByText("加权 Cohen’s kappa：暂无一致性", { exact: true }),
  ).toBeVisible()
})

test("New run lists disabled models and uses themed filters", async ({
  page,
}) => {
  await mockAnalysis(page)
  await page.goto("/evaluation/datasets")
  await page.getByRole("button", { name: "新建运行", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("checkbox", { name: /未启用模型/ }),
  ).toBeDisabled()
  await expect(dialog).toContainText("未启用，当前不可选择")
  await page.screenshot({ path: test.info().outputPath("create-run.png") })
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("combobox", { name: /范围/ }).click()
  await page.getByRole("option", { name: "全局", exact: true }).click()
  await expect(page.getByRole("table")).toBeVisible()
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2)
  await page.getByRole("button", { name: "清除筛选", exact: true }).click()
  await expect(page.getByRole("table")).toContainText("香氛表达（演示）")
})

test("Viral source and semantic skeleton are plain text; conversion stays on the page", async ({
  page,
}) => {
  const writes = await mockAnalysis(page)
  await page.goto("/viral-samples")
  await expect(page.getByRole("table")).toContainText("已有结构")
  await expect(
    page.locator('a[href="https://example.invalid/sample"]'),
  ).toHaveCount(0)
  await page.goto(`/viral-patterns/${ids.pattern}`)
  await expect(
    page.getByText("{保留为普通文字}", { exact: false }),
  ).toBeVisible()
  await page.getByRole("button", { name: "转为场景模板", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("现有最大值加 1")
  await page.screenshot({
    path: test.info().outputPath("convert-template.png"),
  })
  await dialog
    .getByRole("button", { name: "转为场景模板", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page).toHaveURL(`/viral-patterns/${ids.pattern}`)
  await expect(page.getByRole("status")).toContainText("3")
  expect(writes.filter((w) => w.path.endsWith("/to-template"))).toHaveLength(1)
})

test("Analysis uses a synchronous waiting state and disabled models cannot be selected", async ({
  page,
}) => {
  await mockAnalysis(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/viral-samples/*/analyze", async (route) => {
    await pending
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          request_id: "analysis-failed-fixture",
          message: "模型暂时不可用",
        },
        request_id: "analysis-failed-fixture",
      },
    })
  })
  await page.goto(`/viral-samples/${ids.sample}`)
  await page.getByRole("button", { name: "分析结构", exact: true }).click()
  await expect(page.getByRole("radio", { name: /未启用模型/ })).toBeDisabled()
  await page.getByRole("button", { name: "开始分析", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "已等待",
  )
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }),
  ).toHaveCount(0)
  await page.screenshot({
    path: test.info().outputPath("analysis-waiting.png"),
  })
  release?.()
  await expect(page.getByRole("dialog")).toContainText(
    "analysis-failed-fixture",
  )
})

test("Running evaluation never invents percent progress; brand diagnostics use only API metrics", async ({
  page,
}) => {
  await mockAnalysis(page)
  await page.route(`**/api/v1/evaluation/runs/${ids.run}`, (route) =>
    route.fulfill({ json: { ...visualRun, status: "running" } }),
  )
  await page.goto(`/evaluation/runs/${ids.run}`)
  await expect(
    page.getByText("接口未提供完成百分比", { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole("table")).toHaveCount(0)
  await page.route(`**/api/v1/evaluation/runs/${ids.run}`, (route) =>
    route.fulfill({
      json: {
        ...visualRun,
        kind: "brand_leak",
        metrics: {
          full: [
            "leak_rate",
            "retrieval_leak_count",
            "constraint_pass_rate",
            "failure_rate",
            "avg_cost",
          ].map((name) => ({ name, value: 0, n: 1, definition: name })),
        },
      },
    }),
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "检索诊断", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("avg_cost", { exact: true })).toHaveCount(0)
  await expect(page.getByText("综合分", { exact: true })).toHaveCount(0)
})

test("Editors see no evaluation controls or template conversion", async ({
  page,
}) => {
  await mockAnalysis(page, true)
  await page.goto("/evaluation/datasets")
  await expect(page.getByRole("heading", { name: /没有权限/ })).toBeVisible()
  await page.goto(`/viral-patterns/${ids.pattern}`)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "转为场景模板", exact: true }),
  ).toHaveCount(0)
})

test("Empty and error lists retain headers and show a request id", async ({
  page,
}) => {
  await mockAnalysis(page)
  for (const [url, api] of [
    ["/evaluation/datasets", "**/api/v1/evaluation/datasets*"],
    ["/evaluation/runs", "**/api/v1/evaluation/runs?*"],
    ["/viral-samples", "**/api/v1/brands/*/viral-samples?*"],
  ]) {
    await page.route(api, (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
    )
    await page.goto(url)
    await expect(page.getByRole("table")).toBeVisible()
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2)
    await page.route(api, (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: {
            code: "VALIDATION_ERROR",
            request_id: "visual-request-fixture",
            message: "请求内容有误",
          },
          request_id: "visual-request-fixture",
        },
      }),
    )
    await page.reload()
    await expect(page.getByRole("table")).toContainText(
      "visual-request-fixture",
    )
  }
})

test("Dataset creation and sample entry keep counters and right aligned actions", async ({
  page,
}, info) => {
  const writes = await mockAnalysis(page)
  await page.goto("/evaluation/datasets")
  await page.getByRole("button", { name: "新建评测集", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(2)
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "类型", exact: true })
    .click()
  await page.getByRole("option", { name: "合规检测", exact: true }).click()
  await page.getByLabel("名称", { exact: true }).fill("新建评测集（演示）")
  await page.screenshot({ path: info.outputPath("create-dataset.png") })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click()
  await expect
    .poll(() => writes.some((w) => w.path.endsWith("/datasets")))
    .toBe(true)
  await page.goto("/viral-samples")
  await page.getByRole("button", { name: "添加样本", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("5000")
  await page.getByLabel("样本文本", { exact: true }).fill("香氛片段（演示） 🌿")
  await page.screenshot({ path: info.outputPath("add-sample.png") })
  await dialog.getByRole("button", { name: "保存样本", exact: true }).click()
  await expect(page).toHaveURL(`/viral-samples/${ids.sample}`)
  expect(writes.find((w) => w.path.endsWith("/viral-samples"))?.body.text).toBe(
    "香氛片段（演示） 🌿",
  )
})

test("List loading skeletons keep table headers visible", async ({ page }) => {
  await mockAnalysis(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/evaluation/datasets*", async (route) => {
    await pending
    await route.fulfill({ json: { items: [] } })
  })
  await page.goto("/evaluation/datasets")
  await expect(
    page.getByRole("columnheader", { name: "名称", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("table").locator('[data-slot="skeleton"]').first(),
  ).toBeVisible()
  release?.()
  await expect(page.getByRole("table")).toContainText("暂无评测集")
})
