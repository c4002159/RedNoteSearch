import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

const brand = "11111111-1111-4111-8111-111111111111"
const brandSet = "22222222-2222-4222-8222-222222222222"
const globalSet = "33333333-3333-4333-8333-333333333333"
const newSet = "44444444-4444-4444-8444-444444444444"
const date = "2026-11-02T00:00:00Z"

const dataset = (id: string, brand_id: string | null, version = 1) => ({
  id,
  name: brand_id ? "品牌回归集" : "全局回归集",
  kind: "generation",
  brand_id,
  group_id: "group-1",
  version,
  case_count: 2,
  content_hash: "hash-fixture",
  created_at: date,
})
const cases = [0, 1].map((i) => ({
  id: `case-${i}`,
  case_index: i,
  input: { brief: `需求${i}` },
  expected: { style: `风格${i}` },
  annotators: ["标注者"],
}))

async function mockEvaluation(page: Page, opts: { superuser: boolean }) {
  const writes: { path: string; body: Record<string, unknown> }[] = []
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "r6-mock-token")
    localStorage.setItem(
      "current_brand_id",
      "11111111-1111-4111-8111-111111111111",
    )
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data })
    if (path.endsWith("/users/me"))
      return json({
        id: "self",
        email: "self@example.invalid",
        full_name: null,
        is_active: true,
        is_superuser: opts.superuser,
      })
    if (path.endsWith("/brands"))
      return json({
        items: [
          { id: brand, name: "回归品牌", category: "perfume", role: "admin" },
        ],
      })
    if (path.endsWith("/revisions")) {
      writes.push({ path, body: request.postDataJSON() })
      return json(
        dataset(newSet, path.includes(globalSet) ? null : brand, 2),
        201,
      )
    }
    if (path.endsWith("/cases"))
      return json({ items: cases, total: 2, page: 1, page_size: 20 })
    if (path.endsWith("/evaluation/datasets"))
      return json({
        items: [
          dataset(brandSet, brand),
          dataset(globalSet, null),
          dataset(newSet, brand, 2),
        ],
      })
    return json({ items: [], total: 0, page: 1, page_size: 20 })
  })
  return writes
}

test("brand admin edits a sample and the page moves to the new version", async ({
  page,
}) => {
  const writes = await mockEvaluation(page, { superuser: false })
  await page.goto(`/evaluation/datasets/${brandSet}`)
  await expect(page.getByRole("heading", { name: "样本" })).toBeVisible()
  await expect(page.getByText("每页")).toHaveCount(0)
  await page.getByRole("button", { name: "编辑", exact: true }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(
    "保存会生成新版本，旧版本和已有运行记录保留。",
  )
  await dialog.getByLabel("输入（JSON 对象）").fill("{bad")
  await dialog.getByRole("button", { name: "保存为新版本" }).click()
  await expect(dialog.getByRole("alert")).toContainText("合法的 JSON 对象")
  expect(writes).toHaveLength(0)
  await dialog.getByLabel("输入（JSON 对象）").fill('{"brief":"新需求"}')
  await dialog.getByRole("button", { name: "保存为新版本" }).click()
  await expect(page).toHaveURL(new RegExp(`/evaluation/datasets/${newSet}$`))
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toEqual({
    updates: [
      {
        case_index: 0,
        input: { brief: "新需求" },
        expected: { style: "风格0" },
        annotators: ["标注者"],
      },
    ],
  })
})

test("deleting selected samples sends case indexes and creates a new version", async ({
  page,
}) => {
  const writes = await mockEvaluation(page, { superuser: false })
  await page.goto(`/evaluation/datasets/${brandSet}`)
  await page.getByRole("checkbox", { name: "选择 样本 1", exact: true }).check()
  await page.getByRole("button", { name: "已选 1 项", exact: true }).click()
  await page.getByRole("menuitem", { name: "删除所选样本" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("旧版本和已有运行记录保留")
  await dialog.getByRole("button", { name: "生成新版本" }).click()
  await expect(page).toHaveURL(new RegExp(`/evaluation/datasets/${newSet}$`))
  expect(writes[0].body).toEqual({ delete_case_indexes: [1] })
})

test("global dataset is read-only for a non-platform admin, new run sits at the bottom", async ({
  page,
}) => {
  await mockEvaluation(page, { superuser: false })
  await page.goto(`/evaluation/datasets/${globalSet}`)
  await expect(
    page.getByText("只读：全局评测集仅平台管理员可编辑"),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("checkbox", { name: "选择 样本 0", exact: true }).check()
  await page.getByRole("button", { name: "已选 1 项", exact: true }).click()
  await expect(
    page.getByRole("menuitem", { name: "删除所选样本" }),
  ).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page
    .getByRole("button", { name: "查看 JSON", exact: true })
    .first()
    .click()
  await expect(page.getByRole("button", { name: "保存为新版本" })).toHaveCount(
    0,
  )
  await page.keyboard.press("Escape")
  const table = await page.getByRole("table").boundingBox()
  const run = await page.getByRole("button", { name: "新建运行" }).boundingBox()
  expect(run!.y).toBeGreaterThan(table!.y + table!.height - 1)
})

test("platform admin can edit a global dataset", async ({ page }) => {
  await mockEvaluation(page, { superuser: true })
  await page.goto(`/evaluation/datasets/${globalSet}`)
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }).first(),
  ).toBeVisible()
})

const rule = (i: number, enabled: boolean, extra = {}) => ({
  id: `rule-${i}`,
  brand_id: brand,
  pattern: `规则${i}`,
  layer: "lexicon",
  rule_type: "brand_forbidden",
  is_regex: false,
  severity: "warn",
  suggestion: "",
  source_name: i === 1 ? "广告法第九条" : "",
  source_url: null,
  source_clause: i === 1 ? "第一款" : null,
  region_scope: null,
  effective_from: null,
  effective_to: null,
  rule_version: 1,
  enabled,
  is_sample: i === 3,
  ...extra,
})

async function mockRules(page: Page) {
  const calls: { path: string; query: URLSearchParams; body: unknown }[] = []
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "r6-mock-token")
    localStorage.setItem(
      "current_brand_id",
      "11111111-1111-4111-8111-111111111111",
    )
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (data: unknown) => route.fulfill({ json: data })
    if (path.endsWith("/users/me"))
      return json({
        id: "self",
        email: "self@example.invalid",
        full_name: null,
        is_active: true,
        is_superuser: false,
      })
    if (path.endsWith("/brands"))
      return json({
        items: [
          { id: brand, name: "回归品牌", category: "perfume", role: "admin" },
        ],
      })
    if (path.endsWith("/batch-state")) {
      const body = request.postDataJSON() as { ids: string[] }
      calls.push({ path, query: url.searchParams, body })
      return json({
        items: body.ids.map((id) =>
          id === "rule-2"
            ? {
                id,
                success: false,
                status_code: 409,
                error_code: "CONFLICT",
                message: "规则已被他人修改",
              }
            : { id, success: true, changed: true, rule_version: 2 },
        ),
      })
    }
    if (path === "/api/v1/compliance-rules") {
      calls.push({ path, query: url.searchParams, body: null })
      const all = url.searchParams.get("include_inactive") === "true"
      const items = [
        rule(1, true),
        rule(2, true),
        rule(3, true),
        rule(4, false),
      ]
      const shown = all ? items : items.filter((row) => row.enabled)
      return json({ items: shown, total: shown.length, page: 1, page_size: 20 })
    }
    return json({ items: [], total: 0, page: 1, page_size: 20 })
  })
  return calls
}

test("rules table has a source column with hover detail, hides deleted rules by default", async ({
  page,
}) => {
  const calls = await mockRules(page)
  await page.goto("/compliance/rules")
  await expect(page.getByRole("columnheader", { name: "来源" })).toBeVisible()
  await expect(
    page.getByRole("columnheader", { name: "版本 / 状态" }),
  ).toBeVisible()
  await expect(page.getByText("规则4")).toHaveCount(0)
  expect(calls[0].query.get("include_inactive")).toBe("false")
  await page.getByRole("button", { name: "广告法第九条" }).hover()
  await expect(page.getByRole("tooltip")).toContainText("第一款")
  await expect(page.getByRole("button", { name: "待核对" })).toBeVisible()
  await page.getByLabel("显示已删除的规则").check()
  await expect(page.getByText("规则4")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "恢复", exact: true }),
  ).toBeVisible()
  expect(calls[calls.length - 1]?.query.get("include_inactive")).toBe("true")
})

test("batch delete needs a reason, reports per-rule results and retries only failures", async ({
  page,
}) => {
  const calls = await mockRules(page)
  await page.goto("/compliance/rules")
  await page.getByRole("checkbox", { name: "全选本页", exact: true }).check()
  await page.getByRole("button", { name: "已选 3 项", exact: true }).click()
  await page.getByRole("menuitem", { name: "批量删除" }).click()
  const dialog = page.getByRole("dialog")
  const confirm = dialog.getByRole("button", { name: "确认", exact: true })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel("原因（必填，写入审计）").fill("回归测试")
  await confirm.click()
  await expect(dialog.getByRole("alert")).toContainText(
    "规则2：规则已被他人修改",
  )
  await expect(dialog.getByRole("status")).toContainText("已处理 2 条")
  const first = calls.find((c) => c.path.endsWith("/batch-state"))!
  expect(first.body).toEqual({
    ids: ["rule-1", "rule-2", "rule-3"],
    enabled: false,
    reason: "回归测试",
  })
  expect(first.path).toBe(
    `/api/v1/brands/${brand}/compliance-rules/batch-state`,
  )
  await dialog.getByRole("button", { name: "重试失败项" }).click()
  const batches = calls.filter((c) => c.path.endsWith("/batch-state"))
  expect(batches[1].body).toEqual({
    ids: ["rule-2"],
    enabled: false,
    reason: "回归测试",
  })
})

test("batch restore works on deleted rules only", async ({ page }) => {
  const calls = await mockRules(page)
  await page.goto("/compliance/rules")
  await page.getByLabel("显示已删除的规则").check()
  await page.getByRole("checkbox", { name: "选择 规则4", exact: true }).check()
  await page.getByRole("button", { name: "已选 1 项", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "批量删除" })).toBeDisabled()
  await page.getByRole("menuitem", { name: "批量恢复" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("原因（必填，写入审计）").fill("恢复测试")
  await dialog.getByRole("button", { name: "确认", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("已处理 1 条")
  const batch = calls.find((c) => c.path.endsWith("/batch-state"))!
  expect(batch.body).toEqual({
    ids: ["rule-4"],
    enabled: true,
    reason: "恢复测试",
  })
})
