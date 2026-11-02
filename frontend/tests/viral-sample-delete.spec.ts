import { expect, type Page, test } from "@playwright/test"
import { analysisIds as ids, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

async function fixture(page: Page, count = 2, editor = false) {
  await mockAnalysis(page, editor)
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `77777777-7777-4777-8777-${String(i + 1).padStart(12, "0")}`,
    brand_id: ids.brand,
    excerpt: `香气样本 ${i + 1}（演示）`,
    char_count: 40,
    source_url: null,
    note: null,
    created_at: "2026-11-02T00:00:00Z",
  }))
  const state = {
    rows,
    calls: [] as { ids: string[]; path: string }[],
    fail: false,
    wait: undefined as Promise<void> | undefined,
  }
  await page.route("**/api/v1/brands/*/viral-samples**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON()
      state.calls.push({ ids: body.ids, path: url.pathname })
      await state.wait
      if (state.fail)
        return route.fulfill({
          status: 404,
          json: {
            error: {
              code: "NOT_FOUND",
              message: "Not found",
              request_id: "delete-fixture-404",
            },
          },
        })
      state.rows = state.rows.filter((r) => !body.ids.includes(r.id))
      return route.fulfill({ json: { deleted: body.ids.length } })
    }
    const pageNo = Number(url.searchParams.get("page") ?? 1)
    const pageSize = Number(url.searchParams.get("page_size") ?? 20)
    return route.fulfill({
      json: {
        items: state.rows.slice((pageNo - 1) * pageSize, pageNo * pageSize),
        total: state.rows.length,
        page: pageNo,
        page_size: 20,
      },
    })
  })
  await page.goto("/viral-samples")
  await expect(
    page.getByRole("link", { name: "香气样本 1（演示）", exact: true }),
  ).toBeVisible()
  return state
}

test("Single delete requires confirmation and cancel leaves the sample", async ({
  page,
}, info) => {
  const state = await fixture(page)
  const first = page.getByRole("row").filter({ hasText: "香气样本 1（演示）" })
  await first.getByRole("button", { name: "删除", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("将删除 1 个样本")
  await expect(dialog).toContainText("已转换的场景模板会保留")
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(state.calls).toHaveLength(0)
  await first.getByRole("button", { name: "删除", exact: true }).click()
  await expect
    .poll(() => dialog.evaluate((e) => getComputedStyle(e).opacity))
    .toBe("1")
  await page.screenshot({ path: info.outputPath("delete-confirmation.png") })
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(first).toHaveCount(0)
  expect(state.calls).toEqual([
    {
      path: `/api/v1/brands/${ids.brand}/viral-samples/delete`,
      ids: ["77777777-7777-4777-8777-000000000001"],
    },
  ])
})

test("Batch failure preserves selection, request id and allows atomic retry", async ({
  page,
}) => {
  const state = await fixture(page)
  state.fail = true
  for (const checkbox of await page
    .getByRole("checkbox", { name: /^选择 / })
    .all())
    await checkbox.check()
  await page.getByRole("button", { name: /^已选 \d+ 项$/ }).click()
  await page.getByRole("menuitem", { name: "批量删除", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(dialog).toContainText("delete-fixture-404")
  await expect(dialog).not.toContainText("Not found")
  await expect(
    page.getByRole("checkbox", {
      name: /^选择 /,
      checked: true,
      includeHidden: true,
    }),
  ).toHaveCount(2)
  expect(state.rows).toHaveLength(2)
  state.fail = false
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("table")).toContainText("还没有样本")
  await expect(page.getByRole("checkbox", { name: /^选择 / })).toHaveCount(0)
  await expect(
    page.getByRole("checkbox", { name: "全选本页", exact: true }),
  ).toBeDisabled()
  expect(state.calls[1].ids).toEqual(state.calls[0].ids)
})

test("Cross-page selection stops at 50, deletion submits unique ids", async ({
  page,
}) => {
  const state = await fixture(page, 51)
  await page.getByRole("checkbox", { name: "全选本页", exact: true }).check()
  await expect(
    page.getByRole("checkbox", { name: /^选择 /, checked: true }),
  ).toHaveCount(20)
  await expect(
    page.getByText("每次最多选择 50 个", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "选择全部 51 条", exact: true })
    .click()
  await page.getByRole("button", { name: "3", exact: true }).click()
  await expect(page.getByRole("checkbox", { name: /^选择 / })).toHaveCount(11)
  await expect(page.getByRole("checkbox").last()).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "已选 50 项", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: /^已选 \d+ 项$/ }).click()
  await page.getByRole("menuitem", { name: "批量删除", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  expect(state.calls[0].ids).toHaveLength(50)
  expect(new Set(state.calls[0].ids).size).toBe(50)
  await expect(
    page.getByRole("link", { name: "香气样本 51（演示）", exact: true }),
  ).toBeVisible()
})

test("Editors see neither deletion nor selection and never call delete", async ({
  page,
}) => {
  const state = await fixture(page, 2, true)
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /删除/ })).toHaveCount(0)
  expect(state.calls).toHaveLength(0)
})

test("Pending delete cannot repeat or close the confirmation", async ({
  page,
}) => {
  const state = await fixture(page)
  let release: (() => void) | undefined
  state.wait = new Promise<void>((resolve) => {
    release = resolve
  })
  await page
    .getByRole("row")
    .filter({ hasText: "香气样本 1（演示）" })
    .getByRole("button", { name: "删除", exact: true })
    .click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  expect(state.calls).toHaveLength(1)
  release?.()
  await expect(dialog).not.toBeVisible()
})

test("Deletion columns stay inside the scrollable table at desktop and narrow widths", async ({
  page,
}, info) => {
  await fixture(page)
  for (const width of [1433, 1024, 720]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(
      page.getByRole("columnheader", { name: "操作", exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)
    await page.screenshot({
      path: info.outputPath(`sample-delete-${width}.png`),
    })
  }
})
