import { expect, test } from "@playwright/test"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

const base = {
  scene: "seeding",
  structure: "开头、展开、结尾",
  source_pattern_id: null,
  source_pattern_title: null,
}
const global = {
  ...base,
  id: "global-template",
  brand_id: null,
  name: "内置种草模板",
  template_version: 1,
  enabled: true,
}
const own = {
  ...base,
  id: "brand-v1",
  brand_id: analysisIds.brand,
  name: "品牌种草模板",
  template_version: 1,
  enabled: true,
}

async function setup(page: Parameters<typeof mockAnalysis>[0], editor = false) {
  await mockAnalysis(page, editor)
  let items = [{ ...global }, { ...own }]
  const patches: { path: string; body: Record<string, unknown> }[] = []
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.fulfill({ json: { items } }),
  )
  await page.route("**/api/v1/scenario-templates/*", async (route) => {
    const body = route.request().postDataJSON()
    patches.push({ path: new URL(route.request().url()).pathname, body })
    items = items.map((row) =>
      row.id === "brand-v1" ? { ...row, enabled: body.enabled } : row,
    )
    return route.fulfill({ json: items[1] })
  })
  return patches
}

const ownRow = (page: Parameters<typeof mockAnalysis>[0]) =>
  page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "查看模板详情：品牌种草模板 v1",
      exact: true,
    }),
  })

test("Deleting a brand template asks first, hides it, and it can be restored", async ({
  page,
}) => {
  const patches = await setup(page)
  await page.goto("/scenarios")
  await expect(ownRow(page)).toBeVisible()
  await ownRow(page).getByRole("button", { name: "删除", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("删除模板「品牌种草模板」")
  await expect(dialog).toContainText("已经用它生成的任务不受影响")
  expect(patches).toHaveLength(0)
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(patches).toHaveLength(0)

  await ownRow(page).getByRole("button", { name: "删除", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click()
  await expect(ownRow(page)).toHaveCount(0)
  expect(patches).toEqual([
    { path: "/api/v1/scenario-templates/brand-v1", body: { enabled: false } },
  ])

  await page.getByLabel("显示已删除的模板").check()
  await expect(ownRow(page)).toContainText("已删除")
  await ownRow(page).getByRole("button", { name: "恢复", exact: true }).click()
  await expect(ownRow(page)).toContainText("使用中")
  expect(patches[1].body).toEqual({ enabled: true })
})

test("Built-in templates explain why they cannot be deleted; editors see no controls", async ({
  page,
}) => {
  await setup(page)
  await page.goto("/scenarios")
  await expect(page.getByText("内置模板不能删除")).toBeVisible()
  await page.unrouteAll({ behavior: "ignoreErrors" })
  const editorPatches = await setup(page, true)
  await page.goto("/scenarios")
  await expect(ownRow(page)).toBeVisible()
  await expect(
    page.getByRole("button", { name: "删除", exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel("显示已删除的模板")).toHaveCount(0)
  expect(editorPatches).toHaveLength(0)
})
