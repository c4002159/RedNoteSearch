import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const brandId = "11111111-1111-4111-8111-111111111111"
const endpoint = `/api/v1/brands/${brandId}/voice-profile/versions`
const persona = "一二三四五六七八九十一二三四五六七八九十完整的人设说明"
const lists = {
  tone_keywords: ["清冷", "克制", "细腻", "温柔"],
  preferred_words: ["清晨", "从容", "气息", "光线"],
  forbidden_words: ["词一", "词二", "词三", "词四"],
  sample_refs: ["样例一", "样例二", "样例三", "https://example.invalid/纯文本"],
}

async function fixture(page: Page, role = "admin") {
  const state = {
    rows: [1, 2].map((version) => ({
      brand_id: brandId,
      version,
      persona,
      ...structuredClone(lists),
      is_active: version === 1,
      created_at: "2026-11-02T00:00:00Z",
    })),
    writes: [] as { path: string; body: Record<string, unknown> | null }[],
    failSave: false,
  }
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "ui-fixture-not-a-real-token")
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET") {
      if (path.endsWith("/users/me"))
        return route.fulfill({
          json: {
            id: "fixture-user",
            email: "reader@example.invalid",
            full_name: "视觉回归",
            is_active: true,
            is_superuser: false,
          },
        })
      if (path === "/api/v1/brands")
        return route.fulfill({
          json: {
            items: [
              { id: brandId, name: "回归品牌", category: "perfume", role },
            ],
          },
        })
      if (path === endpoint)
        return route.fulfill({ json: { items: state.rows } })
      return route.fulfill({
        json: { items: [], total: 0, page: 1, page_size: 20 },
      })
    }
    state.writes.push({ path, body: request.postDataJSON() })
    if (request.method() === "POST" && path === endpoint) {
      if (state.failSave)
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "请检查输入内容",
              details: {},
              request_id: "voice-save-422",
            },
          },
        })
      const row = {
        ...state.rows[0],
        ...request.postDataJSON(),
        version: 3,
        is_active: false,
      }
      state.rows.push(row)
      return route.fulfill({ status: 201, json: row })
    }
    if (request.method() === "POST" && path === `${endpoint}/2/activate`) {
      state.rows = state.rows.map((row) => ({
        ...row,
        is_active: row.version === 2,
      }))
      return route.fulfill({ json: state.rows[1] })
    }
    return route.abort()
  })
  return state
}

test("Version table previews and dialogs preserve full plain text", async ({
  page,
}, testInfo) => {
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/voice-profile")
  for (const name of [
    "版本号",
    "创建时间",
    "品牌人设",
    "语气关键词",
    "优先词",
    "禁用词",
    "参考样例",
    "可用",
    "操作",
  ])
    await expect(
      page.getByRole("columnheader", { name, exact: true }),
    ).toBeVisible()
  const row = page.getByRole("row").filter({ hasText: "v1" })
  await expect(
    row.getByRole("button", { name: "v1 · 查看品牌人设全文" }),
  ).toHaveText("一二三四五六七八九十一二三四五六七八九十…")
  await expect(row.getByText("+1", { exact: true })).toHaveCount(4)
  await page.screenshot({ path: testInfo.outputPath("voice-table.png") })
  await row.getByRole("button", { name: "v1 · 查看品牌人设全文" }).click()
  await expect(page.getByRole("dialog")).toContainText(persona)
  await page.getByRole("button", { name: "关闭", exact: true }).last().click()
  await row
    .getByRole("button", { name: "v1 · 查看全部参考样例（纯文本）" })
    .click()
  const dialog = page.getByRole("dialog")
  for (const item of lists.sample_refs)
    await expect(dialog.getByText(item, { exact: true })).toBeVisible()
  await expect(dialog.getByRole("link")).toHaveCount(0)
})

test("Edit preserves the old version, retries failed save, and creates an inactive version", async ({
  page,
}, testInfo) => {
  const state = await fixture(page)
  await page.goto("/voice-profile")
  await page
    .getByRole("row")
    .filter({ hasText: "v1" })
    .getByRole("button", { name: "编辑", exact: true })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByLabel("品牌人设", { exact: true })).toHaveValue(
    persona,
  )
  await expect(dialog).toContainText("保存后生成新版本，不会修改原版本")
  await page.screenshot({ path: testInfo.outputPath("edit-version.png") })
  await dialog
    .getByRole("button", { name: "删除 语气关键词 1", exact: true })
    .click()
  await dialog.getByLabel("语气关键词", { exact: true }).fill("通透")
  await dialog
    .getByLabel("语气关键词", { exact: true })
    .dispatchEvent("keydown", { key: "Enter", isComposing: true })
  await expect(dialog.getByLabel("语气关键词", { exact: true })).toHaveValue(
    "通透",
  )
  await dialog.getByLabel("语气关键词", { exact: true }).press("Enter")
  await dialog
    .getByLabel("参考样例（纯文本）", { exact: true })
    .fill("新增样例")
  await dialog.getByLabel("参考样例（纯文本）", { exact: true }).press("Enter")
  expect(state.writes).toHaveLength(0)
  state.failSave = true
  await dialog
    .getByRole("button", { name: "保存后生成新版本", exact: true })
    .click()
  await expect(dialog).toContainText("voice-save-422")
  await expect(dialog.getByText("通透", { exact: true })).toBeVisible()
  state.failSave = false
  await dialog
    .getByRole("button", { name: "保存后生成新版本", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "v3" })).toBeVisible()
  expect(state.rows[0].tone_keywords).toEqual(lists.tone_keywords)
  expect(state.rows[2].is_active).toBe(false)
  expect(state.writes[1]).toEqual({
    path: endpoint,
    body: {
      persona,
      ...lists,
      tone_keywords: ["克制", "细腻", "温柔", "通透"],
      sample_refs: [...lists.sample_refs, "新增样例"],
    },
  })
  await page.getByRole("button", { name: "新建版本", exact: true }).click()
  await expect(
    page.getByRole("dialog").getByLabel("品牌人设", { exact: true }),
  ).toHaveValue("")
})

test("Activate requires confirmation and keeps only one available version", async ({
  page,
}) => {
  const state = await fixture(page)
  await page.goto("/voice-profile")
  await expect(
    page.getByRole("table").getByText("生效中", { exact: true }),
  ).toHaveCount(1)
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await page
    .getByRole("row")
    .filter({ hasText: "v2" })
    .getByRole("button", { name: "选用此版本 v2", exact: true })
    .click()
  expect(state.writes).toHaveLength(0)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click()
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "v2" })
      .getByText("生效中", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("table").getByText("生效中", { exact: true }),
  ).toHaveCount(1)
  expect(state.writes.map((r) => r.path)).toEqual([`${endpoint}/2/activate`])
})

test("Editor can inspect content without maintenance controls", async ({
  page,
}) => {
  const state = await fixture(page, "editor")
  await page.goto("/voice-profile")
  await expect(page.getByRole("table")).toBeVisible()
  for (const name of ["编辑", "新建版本"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /选用此版本/ })).toHaveCount(0)
  await page.getByRole("button", { name: "v1 · 查看品牌人设全文" }).click()
  await expect(page.getByRole("dialog")).toContainText(persona)
  expect(state.writes).toHaveLength(0)
})

test("Loading, empty and forbidden responses remain visible with request id", async ({
  page,
}) => {
  await fixture(page)
  let release: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**${endpoint}`, async (route) => {
    await waiting
    await route.fulfill({ json: { items: [] } })
  })
  await page.goto("/voice-profile")
  await expect(
    page.getByText("正在加载，请稍候…", { exact: true }).first(),
  ).toBeVisible()
  release!()
  await expect(page.getByText("还没有品牌档案", { exact: true })).toBeVisible()
  await page.route(`**${endpoint}`, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "FORBIDDEN",
          message: "无权查看",
          details: {},
          request_id: "voice-list-403",
        },
      },
    }),
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "没有权限查看这个页面" }),
  ).toBeVisible()
  await expect(
    page.getByText("voice-list-403", { exact: true }).first(),
  ).toBeVisible()
})
