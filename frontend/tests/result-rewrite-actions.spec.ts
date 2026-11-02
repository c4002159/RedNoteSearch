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

test("Long recommendations are split without losing Unicode code points", async ({
  page,
}) => {
  const state = await mockResult(page, {
    risks: [{ ...resultRisks[0], suggestion: "🌿".repeat(700) }],
  })
  await mockSequence(page, state)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page.getByRole("button", { name: "按建议改写", exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(2)
  const prefix = "把‘育发’改为："
  expect(
    state.writes
      .map((w) => String(w.body.instruction).slice(prefix.length))
      .join(""),
  ).toBe("🌿".repeat(700))
  for (const write of state.writes)
    expect(
      Array.from(String(write.body.instruction)).length,
    ).toBeLessThanOrEqual(500)
  expect(state.writes[1].path).toContain(resultIds.next)
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
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "一键处理全部风险", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText("部分待处理风险没有改写建议", { exact: false }),
  ).toBeVisible()
})

async function mockSequence(
  page: import("@playwright/test").Page,
  state: Awaited<ReturnType<typeof mockResult>>,
  failAt = 0,
  pending?: Promise<void>,
) {
  const versions = new Map<string, typeof state.version>()
  await page.route("**/api/v1/generation-versions/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "POST" && path.endsWith("/rewrite")) {
      state.writes.push({ path, body: route.request().postDataJSON() })
      if (state.writes.length === failAt) await pending
      if (state.writes.length === failAt)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "MODEL_UNAVAILABLE",
              message: "Model unavailable",
              request_id: "step-failed",
            },
          },
        })
      const id =
        state.writes.length === 1
          ? resultIds.next
          : `bbbbbbb${state.writes.length + 1}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
      state.latest = id
      const version = {
        ...state.version,
        id,
        version_no: state.writes.length + 1,
      }
      versions.set(id, version)
      return route.fulfill({ status: 202, json: version })
    }
    const version = versions.get(path.split("/").pop() ?? "")
    if (route.request().method() === "GET" && version)
      return route.fulfill({ json: version })
    return route.fallback()
  })
}

test("Title risks use titles; mixed fields are sequential and unsupported fields require manual edit", async ({
  page,
}) => {
  const state = await mockResult(page, {
    risks: [
      { ...resultRisks[0], field: "title.0" },
      { ...resultRisks[1], field: "cover.0" },
      { ...resultRisks[2], resolved: false, field: "hashtags" },
    ],
  })
  await mockSequence(page, state)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "一键处理全部风险", exact: true })
    .click()
  await expect.poll(() => state.writes.length).toBe(3)
  expect(state.writes.map((w) => w.body.target)).toEqual([
    "titles",
    "cover",
    "hashtags",
  ])
  expect(state.writes[1].path).toContain(resultIds.next)
  expect(state.writes[2].path).toContain("bbbbbbb3-bbbb")
  await expect(page).toHaveURL(/bbbbbbb4-bbbb/)
  state.risks = [{ ...resultRisks[0], field: "unknown-field" }]
  await page.reload()
  await page.getByRole("tab", { name: /风险/ }).click()
  await expect(page.getByText("请手动编辑", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "按建议改写", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "一键处理全部风险", exact: true }),
  ).toBeDisabled()
})

test("A later failure stops the sequence and exposes completed steps and the saved version", async ({
  page,
}) => {
  const state = await mockResult(page, {
    risks: [
      { ...resultRisks[0], field: "title.0" },
      { ...resultRisks[1], field: "body" },
      { ...resultRisks[2], resolved: false, field: "cover.0" },
    ],
  })
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await mockSequence(page, state, 2, pending)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "一键处理全部风险", exact: true })
    .click()
  await expect(page.getByText("第 2 / 3 步", { exact: true })).toBeVisible()
  release?.()
  await expect(page.getByText("改写已停止", { exact: false })).toContainText(
    "已完成 1 / 3 步（标题）",
  )
  await expect(page.getByRole("alert")).toContainText("step-failed")
  expect(state.writes).toHaveLength(2)
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toBeDisabled()
  await page.getByRole("button", { name: "打开已完成的最新版本" }).click()
  await expect(page).toHaveURL(
    `/tasks/${resultIds.task}/versions/${resultIds.next}`,
  )
  await expect(
    page.getByRole("button", { name: "换一批标签", exact: true }),
  ).toBeEnabled()
})

test("Many risks exceed 500 in total without discarding later recommendations", async ({
  page,
}) => {
  const risks = Array.from({ length: 8 }, (_, i) => ({
    ...resultRisks[0],
    id: `many-${i}`,
    matched_text: `命中${i}`,
    suggestion: `建议${i}${"说明".repeat(65)}`,
  }))
  const state = await mockResult(page, { risks })
  await mockSequence(page, state)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "一键处理全部风险", exact: true })
    .click()
  await expect(page).toHaveURL(/bbbbbbb4-bbbb/)
  expect(state.writes).toHaveLength(3)
  for (const risk of risks)
    expect(
      state.writes.map((w) => String(w.body.instruction)).join("\n"),
    ).toContain(`把‘${risk.matched_text}’改为：${risk.suggestion}`)
  for (const write of state.writes)
    expect(
      Array.from(String(write.body.instruction)).length,
    ).toBeLessThanOrEqual(500)
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
