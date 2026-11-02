import { expect, type Page, test } from "@playwright/test"
import type { ProductPublic } from "../src/client"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = analysisIds.brand
const initial: ProductPublic = {
  id: "33333333-3333-4333-8333-333333333333",
  brand_id: brand,
  name: "香调保留商品",
  category: "perfume",
  product_line: null,
  notes: { top: ["佛手柑"], middle: ["茶"], base: ["雪松"] },
  selling_points: [],
  restricted_claims: [],
  status: "active",
}

async function fixture(page: Page, rows: ProductPublic[] = [], editor = false) {
  await mockAnalysis(page, editor)
  const state = {
    rows: structuredClone(rows),
    writes: [] as Record<string, unknown>[],
    fail: false,
  }
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "GET") {
      if (path.endsWith("/knowledge-documents"))
        return route.fulfill({
          json: { items: [], total: 0, page: 1, page_size: 20 },
        })
      if (path.endsWith("/scenarios"))
        return route.fulfill({
          json: {
            items: [
              {
                id: "scenario",
                scene: "seeding",
                name: "生活场景",
                brand_id: null,
                template_version: 1,
                structure: "日常体验",
              },
            ],
          },
        })
      if (path.endsWith("/creative-types"))
        return route.fulfill({
          json: {
            items: [
              {
                key: "seeding",
                name: "种草",
                builtin: true,
                template_count: 1,
              },
            ],
          },
        })
      if (path.endsWith("/style-presets"))
        return route.fulfill({ json: { items: [] } })
    }
    if (
      path !== `/api/v1/brands/${brand}/products` &&
      !path.startsWith("/api/v1/products/")
    )
      return route.fallback()
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          items: state.rows,
          total: state.rows.length,
          page: 1,
          page_size: 20,
        },
      })
    const body = route.request().postDataJSON()
    state.writes.push(body)
    if (state.fail)
      return route.fulfill({
        status: 422,
        json: {
          error: {
            code: "VALIDATION_ERROR",
            message: "请检查商品种类",
            details: {},
            request_id: "product-category-422",
          },
        },
      })
    const row: ProductPublic = {
      ...structuredClone(initial),
      notes: { top: [], middle: [], base: [] },
      ...body,
      id: initial.id,
    }
    state.rows = [row]
    return route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: row,
    })
  })
  return state
}

async function create(page: Page) {
  await page.goto("/products")
  await page.getByRole("button", { name: "新增商品", exact: true }).click()
  await page.getByLabel("商品名称", { exact: true }).fill("新商品")
  return page.getByRole("dialog")
}

test("Product category fragrance presets show notes; other categories offer manual notes", async ({
  page,
}) => {
  await fixture(page)
  const dialog = await create(page)
  const category = page.locator("#product-category")
  await expect(category).toHaveValue("其他")
  for (const value of ["香水", "家居香氛", "perfume", "home_fragrance"]) {
    await category.fill(value)
    for (const id of ["top", "middle", "base"])
      await expect(page.locator(`#notes-${id}`)).toBeVisible()
  }
  for (const value of ["护肤", "香膏"]) {
    await category.fill(value)
    await expect(page.locator("#notes-top")).toHaveCount(0)
    await expect(
      dialog.getByRole("button", { name: "这是香水/香氛类？添加香调" }),
    ).toBeVisible()
  }
  await dialog
    .getByRole("button", { name: "这是香水/香氛类？添加香调" })
    .click()
  for (const id of ["top", "middle", "base"])
    await expect(page.locator(`#notes-${id}`)).toBeVisible()
})

test("Product category custom text saves and appears in list and detail", async ({
  page,
}) => {
  const state = await fixture(page)
  const dialog = await create(page)
  await page.locator("#product-category").fill(" 香膏 ")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.writes[0]).toMatchObject({
    category: "香膏",
    notes: { top: [], middle: [], base: [] },
  })
  const row = page.getByRole("row").filter({ hasText: "新商品" })
  await expect(
    row.getByRole("cell", { name: "香膏", exact: true }),
  ).toBeVisible()
  await row.getByRole("button", { name: "查看", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("香膏")
})

test("Product category edits retain existing notes when changed to skincare", async ({
  page,
}) => {
  const state = await fixture(page, [initial])
  await page.goto("/products")
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(page.locator("#product-category")).toHaveValue("香水")
  await page.locator("#product-category").fill("护肤")
  for (const id of ["top", "middle", "base"])
    await expect(page.locator(`#notes-${id}`)).toBeVisible()
  for (const text of ["佛手柑", "茶", "雪松"])
    await expect(dialog.getByText(text, { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.writes[0]).toMatchObject({
    category: "skincare",
    notes: initial.notes,
  })
})

test("Product category newly entered notes stay visible across category changes", async ({
  page,
}) => {
  const state = await fixture(page)
  const dialog = await create(page)
  await page.locator("#product-category").fill("香水")
  await page.locator("#notes-top").fill("柑橘")
  await page.locator("#notes-top").press("Enter")
  await page.locator("#product-category").fill("护肤")
  await expect(page.locator("#notes-top")).toBeVisible()
  await expect(dialog.getByText("柑橘", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.writes[0]).toMatchObject({
    category: "skincare",
    notes: { top: ["柑橘"], middle: [], base: [] },
  })
})

test("Product category validates Unicode length and keeps failed save open with request id", async ({
  page,
}) => {
  const state = await fixture(page)
  const dialog = await create(page)
  for (const value of [" ", "🌸".repeat(31)]) {
    await page.locator("#product-category").fill(value)
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.locator("#product-category-error")).not.toBeEmpty()
  }
  expect(state.writes).toHaveLength(0)
  state.fail = true
  await page.locator("#product-category").fill("🌸".repeat(30))
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toContainText("product-category-422")
  expect(state.writes[0].category).toBe("🌸".repeat(30))
  state.fail = false
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test("Product category presets submit keys and custom names retain prototype-like text", async ({
  page,
}) => {
  const state = await fixture(page)
  let dialog = await create(page)
  await page.locator("#product-category").fill("香水")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.writes[0].category).toBe("perfume")
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  dialog = page.getByRole("dialog")
  await page.locator("#product-category").fill("constructor")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole("cell", { name: "constructor", exact: true }),
  ).toBeVisible()
})

test("Product category editor sees custom text but no maintenance actions", async ({
  page,
}) => {
  await fixture(page, [{ ...initial, category: "香膏" }], true)
  await page.goto("/products")
  await expect(
    page.getByRole("cell", { name: "香膏", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "新增商品", exact: true }),
  ).toHaveCount(0)
})

test("Product category promotion metadata shows the custom category unchanged", async ({
  page,
}) => {
  await fixture(page, [{ ...initial, category: "香膏" }])
  await page.goto("/generate")
  await page.getByRole("combobox", { name: "选择商品", exact: true }).click()
  await page.getByRole("option", { name: initial.name, exact: true }).click()
  await expect(page.getByText("类目：香膏", { exact: true })).toBeVisible()
})

for (const width of [1440, 1280]) {
  test(`Product category layout has no overflow at ${width}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    await fixture(page, [{ ...initial, category: "香膏" }])
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/products")
    await expect(
      page.getByRole("cell", { name: "香膏", exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`products-${width}.png`),
      animations: "disabled",
    })
    await page.getByRole("button", { name: "编辑", exact: true }).click()
    await expect(page.locator("#product-category")).toHaveValue("香膏")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`product-form-${width}.png`),
      animations: "disabled",
    })
    expect(errors).toEqual([])
  })
}
