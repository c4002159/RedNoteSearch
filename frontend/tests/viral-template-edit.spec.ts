import { expect, test } from "@playwright/test"
import {
  analysisIds as ids,
  mockAnalysis,
  visualPattern,
} from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

async function openConvert(page: import("@playwright/test").Page) {
  await page.goto(`/viral-patterns/${ids.pattern}`)
  await expect(
    page.getByRole("region", { name: "样本详情", exact: true }),
  ).toBeVisible()
  const collapse = page.getByRole("button", { name: "已分析结构", exact: true })
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await collapse.click()
  await expect(
    page.getByRole("button", { name: "查看", exact: true }),
  ).not.toBeVisible()
  await expect(
    page.getByRole("region", {
      name: "模型与版本信息 · 来源样本信息",
      exact: true,
    }),
  ).toBeVisible()
  await collapse.click()
  await page.getByRole("button", { name: "转为场景模板", exact: true }).click()
  return page.getByRole("dialog")
}

test("Edited structure is submitted explicitly with reject, and conversion stays on detail", async ({
  page,
}, info) => {
  const writes = await mockAnalysis(page)
  const dialog = await openConvert(page)
  await expect(dialog.getByLabel("模板结构", { exact: true })).toHaveValue(
    visualPattern.abstract_template,
  )
  await dialog
    .getByLabel("模板结构", { exact: true })
    .fill("先说场景，再展开感受 🌿")
  await expect
    .poll(() => dialog.evaluate((e) => getComputedStyle(e).opacity))
    .toBe("1")
  await page.screenshot({ path: info.outputPath("editable-template.png") })
  await dialog
    .getByRole("button", { name: "转为场景模板", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  expect(writes[0].body).toMatchObject({
    structure: "先说场景，再展开感受 🌿",
    on_name_conflict: "reject",
  })
  await expect(page).toHaveURL(`/viral-patterns/${ids.pattern}`)
  await expect(page.getByRole("main").last()).toContainText("3")
})

test("Name conflict requires explicit choice; rename keeps edited structure", async ({
  page,
}) => {
  await mockAnalysis(page)
  const bodies: Record<string, unknown>[] = []
  await page.route("**/to-template", async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: "CONFLICT",
          message: "Name conflict",
          request_id: "conflict-demo",
        },
      },
    })
  })
  const dialog = await openConvert(page)
  await dialog.getByLabel("模板结构", { exact: true }).fill("人工修改的结构")
  await dialog
    .getByRole("button", { name: "转为场景模板", exact: true })
    .click()
  await expect(dialog).toContainText("conflict-demo")
  await expect(dialog).not.toContainText("Name conflict")
  expect(bodies).toHaveLength(1)
  await dialog.getByRole("button", { name: "存为新版本", exact: true }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[1]).toMatchObject({
    structure: "人工修改的结构",
    on_name_conflict: "new_version",
  })
  await expect(dialog.getByRole("button", { name: "换个名字" })).toBeVisible()
  await dialog.getByRole("button", { name: "换个名字" }).click()
  await expect(dialog.getByLabel("场景模板名称", { exact: true })).toBeFocused()
  await expect(dialog.getByLabel("模板结构", { exact: true })).toHaveValue(
    "人工修改的结构",
  )
  await dialog
    .getByLabel("场景模板名称", { exact: true })
    .fill("另一个名字（演示）")
  await dialog
    .getByRole("button", { name: "转为场景模板", exact: true })
    .click()
  await expect.poll(() => bodies.length).toBe(3)
  expect(bodies[2]).toMatchObject({
    name: "另一个名字（演示）",
    on_name_conflict: "reject",
  })
})

test("Structure uses codepoints and rejects blank or over 2000", async ({
  page,
}) => {
  const writes = await mockAnalysis(page)
  const dialog = await openConvert(page)
  const structure = dialog.getByLabel("模板结构", { exact: true })
  const submit = dialog.getByRole("button", {
    name: "转为场景模板",
    exact: true,
  })
  await structure.fill(" ")
  await submit.click()
  await expect(dialog).toContainText("请填写模板结构")
  await structure.fill("🌿".repeat(2001))
  await expect(submit).toBeDisabled()
  await structure.fill("🌿".repeat(2000))
  await expect(dialog).toContainText("2000 / 2000")
  await submit.click()
  await expect(dialog).not.toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0].body.structure).toBe("🌿".repeat(2000))
})

test("Direct rename clears a conflict without the rename button and retains edited structure", async ({
  page,
}) => {
  await mockAnalysis(page)
  const bodies: Record<string, unknown>[] = []
  await page.route("**/to-template", async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    if (bodies.length === 1)
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "CONFLICT",
            message: "Name conflict",
            request_id: "direct-rename-conflict",
          },
        },
      })
    return route.fulfill({
      json: {
        id: "new-template-fixture",
        name: body.name,
        template_version: 1,
        scene: body.scene,
        structure: body.structure,
      },
    })
  })
  const dialog = await openConvert(page)
  const submit = dialog.getByRole("button", {
    name: "转为场景模板",
    exact: true,
  })
  await dialog.getByLabel("模板结构", { exact: true }).fill("保留这段编辑结构")
  await submit.click()
  await expect(dialog).toContainText("direct-rename-conflict")
  await expect(submit).toBeDisabled()
  await dialog
    .getByLabel("场景模板名称", { exact: true })
    .fill("直接修改名称（演示）")
  await expect(submit).toBeEnabled()
  await expect(dialog).not.toContainText("direct-rename-conflict")
  await expect(dialog.getByLabel("模板结构", { exact: true })).toHaveValue(
    "保留这段编辑结构",
  )
  expect(bodies).toHaveLength(1)
  await submit.click()
  await expect(dialog).not.toBeVisible()
  expect(bodies[1]).toMatchObject({
    name: "直接修改名称（演示）",
    structure: "保留这段编辑结构",
    on_name_conflict: "reject",
  })
})

test("Editor has no conversion control", async ({ page }) => {
  const writes = await mockAnalysis(page, true)
  await page.goto(`/viral-patterns/${ids.pattern}`)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "转为场景模板", exact: true }),
  ).toHaveCount(0)
  expect(writes).toHaveLength(0)
})

test("Pending conversion prevents duplicate submits and dialog dismissal", async ({
  page,
}) => {
  await mockAnalysis(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await page.route("**/to-template", async (route) => {
    calls++
    await pending
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "Model unavailable",
          request_id: "convert-retry",
        },
      },
    })
  })
  const dialog = await openConvert(page)
  await dialog
    .getByRole("button", { name: "转为场景模板", exact: true })
    .click()
  await expect(dialog.getByLabel("模板结构", { exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  expect(calls).toBe(1)
  release?.()
  await expect(dialog).toContainText("convert-retry")
  await expect(dialog).not.toContainText("Model unavailable")
  await expect(dialog.getByLabel("模板结构", { exact: true })).toHaveValue(
    visualPattern.abstract_template,
  )
})

test("Sample edits PATCH text and source, retain the unified layout and mark old structures", async ({
  page,
}) => {
  await mockAnalysis(page)
  let sample = {
    id: ids.sample,
    brand_id: ids.brand,
    text: "原始样本文字",
    source_url: null as string | null,
    note: null,
    created_at: "2026-11-02T00:00:00Z",
    structures_stale: false,
  }
  const writes: Record<string, unknown>[] = []
  await page.route(`**/api/v1/viral-samples/${ids.sample}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON()
      writes.push(body)
      sample = { ...sample, ...body, structures_stale: true }
    }
    await route.fulfill({ json: sample })
  })
  await page.goto(`/viral-samples/${ids.sample}`)
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await page.getByLabel("样本文字", { exact: true }).fill("编辑后的样本 🌿")
  await page
    .getByLabel("来源链接", { exact: true })
    .fill("https://example.invalid/source")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "样本详情", exact: true }),
  ).toContainText("编辑后的样本 🌿")
  await expect(
    page.getByText("结构基于修改前的文字", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "重新分析", exact: true }),
  ).toBeEnabled()
  expect(writes).toEqual([
    { text: "编辑后的样本 🌿", source_url: "https://example.invalid/source" },
  ])
  const order = await page
    .getByRole("main")
    .last()
    .locator("section[aria-label]")
    .evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("aria-label")),
    )
  expect(order).toEqual([
    "样本详情",
    "已分析结构",
    "模型与版本信息 · 来源样本信息",
  ])
  await expect(
    page.getByRole("link", { name: "返回上一级", exact: true }),
  ).toHaveAttribute("href", "/viral-samples")
})
