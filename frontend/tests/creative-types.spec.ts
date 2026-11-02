import { expect, type Page, test } from "@playwright/test"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const builtins = ["种草", "测评", "教程", "上新", "促销", "故事"].map(
  (name, i) => ({
    key: ["seeding", "review", "tutorial", "launch", "promotion", "story"][i],
    name,
    builtin: true,
    template_count: i + 1,
  }),
)
const own = {
  key: "c12345678",
  name: "调香师对谈",
  builtin: false,
  template_count: 3,
}
async function setup(page: Page, editor = false) {
  await mockAnalysis(page, editor)
  await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 1 } }),
  )
  const state = {
    items: [...builtins, { ...own }],
    writes: [] as {
      method: string
      body: Record<string, unknown> | null
      path: string
    }[],
    conflict: false,
  }
  await page.route("**/api/v1/brands/*/creative-types**", async (route) => {
    const request = route.request(),
      method = request.method(),
      path = new URL(request.url()).pathname
    if (method === "GET") return route.fulfill({ json: { items: state.items } })
    const body = request.postData() ? request.postDataJSON() : null
    state.writes.push({ method, body, path })
    if (method === "DELETE") {
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "CONFLICT",
              message: "This creative type is still in use",
              request_id: "type-used",
              details: { templates: 3, confirmed_copies: 2 },
            },
          },
        })
      state.items = state.items.filter((r) => !path.endsWith(r.key))
      return route.fulfill({ status: 204 })
    }
    const row = {
      ...own,
      name: body.name,
      key: method === "POST" ? "cnew12345" : own.key,
    }
    state.items =
      method === "POST"
        ? [...state.items, row]
        : state.items.map((r) => (r.key === own.key ? row : r))
    return route.fulfill({ status: method === "POST" ? 201 : 200, json: row })
  })
  return state
}

test("Creative types admin creates, renames and handles referenced deletion", async ({
  page,
}) => {
  const state = await setup(page)
  await page.goto("/creative-types")
  await page.getByRole("button", { name: "新建类型", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const input = dialog.getByLabel("类型名称", { exact: true })
  await input.fill("🌿".repeat(21))
  await expect(
    dialog.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled()
  await input.fill("  香气观察  ")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(state.writes[0].body).toEqual({ name: "香气观察" })
  expect(state.writes[0].path).toContain(analysisIds.brand)
  await page
    .getByRole("button", { name: "管理类型：调香师对谈", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click()
  await input.fill("调香对谈")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(state.writes[1].path).toContain(own.key)
  state.conflict = true
  await page
    .getByRole("button", { name: "管理类型：调香对谈", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "删除类型", exact: true }).click()
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(dialog).toContainText(
    "还有 3 个模板版本、2 篇已确认文案在使用，不能删除",
  )
  await expect(dialog).toContainText("type-used")
  state.conflict = false
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("table")).not.toContainText("调香对谈")
})

test("Creative types editor is read only and builtin identifiers are Chinese", async ({
  page,
}) => {
  const state = await setup(page, true)
  await page.goto("/creative-types")
  await expect(page.getByText("当前权限：编辑者（只读视图）")).toBeVisible()
  await expect(
    page.getByRole("button", { name: /新建类型|管理类型/ }),
  ).toHaveCount(0)
  await expect(page.getByRole("table")).not.toContainText("seeding")
  await expect(page.getByRole("table")).toContainText(own.key)
  expect(state.writes).toHaveLength(0)
})

test("Creative types loading empty and forbidden states keep the table and request id", async ({
  page,
}) => {
  await setup(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/brands/*/creative-types", async (route) => {
    await pending
    await route.fulfill({ json: { items: [] } })
  })
  await page.goto("/creative-types")
  await expect(
    page.getByRole("table").locator('[data-slot="skeleton"]'),
  ).toBeVisible()
  release?.()
  await expect(page.getByRole("table")).toContainText("还没有可显示的创作类型")
  await page.route("**/api/v1/brands/*/creative-types", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "FORBIDDEN",
          message: "Forbidden",
          request_id: "creative-forbidden",
        },
      },
    }),
  )
  await page.reload()
  await expect(page.getByRole("table")).toContainText("creative-forbidden")
  await expect(
    page.getByRole("heading", { name: "没有权限查看这个页面", exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).not.toContainText("Forbidden")
})

test("Creative types preview matches desktop hierarchy without overflow or console errors", async ({
  page,
}, info) => {
  await setup(page)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(
        `HTTP ${response.status()} ${new URL(response.url()).pathname}`,
      )
  })
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/creative-types")
    await expect(page.getByRole("table")).toContainText(own.name)
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)
    await page.screenshot({
      path: info.outputPath(`creative-types-${width}.png`),
    })
  }
  expect(errors).toEqual([])
})
