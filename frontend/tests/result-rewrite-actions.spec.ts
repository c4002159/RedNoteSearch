import { expect, test } from "@playwright/test"
import {
  mockResult,
  resultIds,
  resultRisks,
  resultUrl,
} from "./utils/resultVisual"

test.use({ storageState: { cookies: [], origins: [] } })

test("A risk rewrites the body using the exact recommendation and opens the new version", async ({
  page,
}) => {
  const state = await mockResult(page)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  const card = page
    .getByRole("listitem")
    .filter({ hasText: resultRisks[0].suggestion })
  await card.getByRole("button", { name: "按建议改写", exact: true }).click()
  await expect(page).toHaveURL(
    `/tasks/${resultIds.task}/versions/${resultIds.next}`,
  )
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toEqual({
    path: `/api/v1/generation-versions/${resultIds.version}/rewrite`,
    body: {
      target: "body",
      instruction: `把‘育发’改为：${resultRisks[0].suggestion}`,
    },
  })
})

test("One-click risk rewrite includes every unresolved recommendation and excludes resolved risks", async ({
  page,
}) => {
  const state = await mockResult(page)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "一键处理全部风险", exact: true })
    .click()
  await expect.poll(() => state.writes.length).toBe(1)
  const instruction = String(state.writes[0].body.instruction)
  expect(instruction).toContain(resultRisks[0].matched_text)
  expect(instruction).toContain(resultRisks[1].suggestion)
  expect(instruction).not.toContain(resultRisks[2].matched_text)
  expect(state.writes[0].body.target).toBe("body")
})

test("Long recommendations are truncated at 500 Unicode code points", async ({
  page,
}) => {
  const state = await mockResult(page, {
    risks: [{ ...resultRisks[0], suggestion: "🌿".repeat(700) }],
  })
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page.getByRole("button", { name: "按建议改写", exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  const instruction = String(state.writes[0].body.instruction)
  expect(Array.from(instruction)).toHaveLength(500)
  expect(instruction).not.toMatch(/[\uD800-\uDBFF]$/)
})

test("Refreshing tags uses the hashtags target even when there are no old tags", async ({
  page,
}) => {
  const state = await mockResult(page, { tags: [] })
  await page.goto(resultUrl)
  await expect(page.getByText("暂无推荐标签", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "换一批标签", exact: true }).click()
  await expect(page).toHaveURL(
    `/tasks/${resultIds.task}/versions/${resultIds.next}`,
  )
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].body).toEqual({ target: "hashtags" })
})

test("Failed rewrites retain the original version and request id; absent suggestions are not invented", async ({
  page,
}) => {
  const state = await mockResult(page)
  await page.route("**/api/v1/generation-versions/*/rewrite", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "Model unavailable",
          request_id: "rewrite-fixture",
        },
      },
    }),
  )
  await page.goto(resultUrl)
  await page.getByRole("button", { name: "换一批标签", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("rewrite-fixture")
  await expect(page.getByRole("alert")).not.toContainText("Model unavailable")
  await expect(page).toHaveURL(resultUrl)
  expect(state.writes).toEqual([])
  state.risks = [{ ...resultRisks[0], suggestion: "" }]
  await page.reload()
  await page.getByRole("tab", { name: /风险/ }).click()
  await expect(
    page.getByRole("button", { name: "按建议改写", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "一键处理全部风险", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText("部分待处理风险没有改写建议", { exact: false }),
  ).toBeVisible()
})

test("Historical and checking versions have no quick rewrite controls", async ({
  page,
}) => {
  await mockResult(page, { historical: true })
  await page.goto(resultUrl)
  await expect(page.getByText("历史版本", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("tab", { name: /风险/ }).click()
  await expect(
    page.getByRole("button", { name: "按建议改写", exact: true }),
  ).toHaveCount(0)
  await mockResult(page, { flow: "checking" })
  await page.reload()
  await expect(page.getByText("检查中", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toHaveCount(0)
})

test("Existing manual rewrite keeps its target and instruction", async ({
  page,
}) => {
  const state = await mockResult(page)
  await page.goto(resultUrl)
  await page.getByLabel("重写部分", { exact: true }).selectOption("cover")
  await page.getByLabel("重写要求", { exact: true }).fill("请使用短句（演示）")
  await page.getByRole("button", { name: "重写", exact: true }).click()
  await expect(page).toHaveURL(
    `/tasks/${resultIds.task}/versions/${resultIds.next}`,
  )
  expect(state.writes[0].body).toEqual({
    target: "cover",
    instruction: "请使用短句（演示）",
  })
})

test("A pending rewrite disables the other rewrite actions and recovers after failure", async ({
  page,
}) => {
  await mockResult(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await page.route("**/api/v1/generation-versions/*/rewrite", async (route) => {
    calls++
    await pending
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "模型暂时不可用",
          request_id: "pending-rewrite-fixture",
        },
      },
    })
  })
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "一键处理全部风险", exact: true })
    .click()
  await expect(
    page.getByText("正在改写，完成后将打开新版本；原版本保留。", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "重写", exact: true }),
  ).toBeDisabled()
  for (const button of await page
    .getByRole("button", { name: "按建议改写", exact: true })
    .all())
    await expect(button).toBeDisabled()
  await page.screenshot({
    path: test.info().outputPath("result-rewrite-pending.png"),
    fullPage: true,
  })
  expect(calls).toBe(1)
  release?.()
  await expect(page.getByRole("alert")).toContainText("pending-rewrite-fixture")
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toBeEnabled()
  await expect(page).toHaveURL(resultUrl)
})
