import { expect, test } from "@playwright/test"

const brand = "11111111-1111-4111-8111-111111111111"
const known = "22222222-2222-4222-8222-222222222222"
const globalId = "33333333-3333-4333-8333-333333333333"
const unknown = "44444444-4444-4444-8444-444444444444"
const runId = "55555555-5555-4555-8555-555555555555"
const datasets = [
  { id: known, name: "品牌规则回归集", kind: "compliance", brand_id: brand },
  { id: globalId, name: "全局回归集", kind: "factcheck", brand_id: null },
  {
    id: unknown,
    name: "缺少品牌名回归集",
    kind: "generation",
    brand_id: "66666666-6666-4666-8666-666666666666",
  },
].map((d) => ({
  ...d,
  group_id: d.id,
  version: 2,
  case_count: 1,
  content_hash: "fixture-hash",
  created_at: "2026-11-02T00:00:00Z",
}))

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/brands", (r) =>
    r.fulfill({
      json: {
        items: [
          { id: brand, name: "回归品牌", category: "perfume", role: "admin" },
        ],
      },
    }),
  )
  await page.route(/\/api\/v1\/evaluation\/datasets(?:\?|$)/, (r) => {
    const kind = new URL(r.request().url()).searchParams.get("kind")
    return r.fulfill({
      json: { items: datasets.filter((d) => !kind || d.kind === kind) },
    })
  })
  await page.route("**/api/v1/evaluation/datasets/*/cases?*", (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  )
})

test("Dataset table shows Chinese scope, columns and filter recovery", async ({
  page,
}) => {
  await page.goto("/evaluation/datasets")
  await expect(page.getByRole("table")).toBeVisible()
  for (const name of [
    "名称",
    "类型",
    "范围",
    "版本",
    "样本数",
    "创建时间",
    "操作",
  ])
    await expect(
      page.getByRole("columnheader", { name, exact: true }),
    ).toBeVisible()
  await expect(page.getByRole("table")).toContainText("回归品牌")
  await expect(page.getByRole("table")).toContainText("其他品牌")
  await expect(page.getByRole("table")).not.toContainText(brand)
  await expect(
    page.getByText("评测集创建后内容固定；修改会产生新版本，旧版本保留。", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "评测运行与报告", exact: true }).last(),
  ).toBeVisible()
  await page.getByLabel("类型", { exact: true }).selectOption("compliance")
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2)
  await page.getByRole("button", { name: "清除筛选", exact: true }).click()
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(4)
})

test("Dataset detail scope uses name, global and missing-name fallback", async ({
  page,
}) => {
  for (const [id, name] of [
    [known, "回归品牌"],
    [globalId, "全局"],
    [unknown, "其他品牌"],
  ]) {
    await page.goto(`/evaluation/datasets/${id}`)
    const scope = page.getByText("范围", { exact: true }).locator("..")
    await expect(scope).toContainText(name)
    await expect(scope).not.toContainText("66666666")
  }
})

test("Run detail links named dataset and labels evaluation systems", async ({
  page,
}) => {
  await page.route(`**/api/v1/evaluation/runs/${runId}`, (r) =>
    r.fulfill({
      json: {
        id: runId,
        dataset_id: known,
        kind: "compliance",
        status: "completed",
        sample_count: 1,
        versions: {
          dataset_version: 2,
          prompt_version: null,
          checker_version: "fixture",
          rubric_version: null,
          models: [],
          baselines: ["lexicon_only"],
        },
        metrics: {
          full: [],
          "baseline:lexicon_only": [],
          "model:demo-model": [],
          "unknown-system": [],
        },
        failures: [],
        error: null,
        created_at: null,
        finished_at: null,
      },
    }),
  )
  await page.route(`**/api/v1/evaluation/runs/${runId}/results?*`, (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  )
  await page.route(`**/api/v1/evaluation/runs/${runId}/agreement`, (r) =>
    r.fulfill({
      json: { method: "fixture", raters: 0, rated_results: 0, dimensions: [] },
    }),
  )
  await page.goto(`/evaluation/runs/${runId}`)
  await expect(
    page.getByRole("link", { name: "品牌规则回归集", exact: true }),
  ).toHaveAttribute("href", `/evaluation/datasets/${known}`)
  for (const name of [
    "完整系统",
    "基线：仅词表匹配",
    "模型：demo-model",
    "unknown-system",
  ])
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await page.getByRole("link", { name: "品牌规则回归集", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "品牌规则回归集", exact: true }),
  ).toBeVisible()
  await page.route(/\/api\/v1\/evaluation\/datasets(?:\?|$)/, (r) =>
    r.fulfill({ json: { items: [] } }),
  )
  await page.goto(`/evaluation/runs/${runId}`)
  await expect(
    page.locator(`a[href="/evaluation/datasets/${known}"]`),
  ).toHaveText("评测集")
})
