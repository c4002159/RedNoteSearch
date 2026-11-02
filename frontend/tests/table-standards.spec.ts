import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = "11111111-1111-4111-8111-111111111111"

async function fixture(page: Page, count = 61, editor = false) {
  const state = {
    fail: new Set<string>(),
    calls: [] as { id: string; path: string; body: unknown }[],
    active: 0,
    maxActive: 0,
    wait: undefined as Promise<void> | undefined,
    products: Array.from({ length: count }, (_, i) => ({
      id: `product-${i + 1}`,
      brand_id: brand,
      name: `商品${i + 1}`,
      product_line: null,
      category: "perfume",
      status: "active",
      selling_points: [],
      notes: { top: [], middle: [], base: [] },
      restricted_claims: [],
    })),
    rules: Array.from({ length: count }, (_, i) => ({
      id: `rule-${i + 1}`,
      brand_id: brand,
      pattern: `规则${i + 1}`,
      layer: "lexicon",
      rule_type: "brand_forbidden",
      is_regex: false,
      severity: "warn",
      suggestion: "",
      source_name: "",
      source_url: null,
      source_clause: null,
      region_scope: null,
      effective_from: null,
      effective_to: null,
      rule_version: 1,
      enabled: true,
      is_sample: false,
    })),
  }
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "r6-mock-token")
    localStorage.setItem(
      "current_brand_id",
      "11111111-1111-4111-8111-111111111111",
    )
  })
  const users = [
    {
      id: "self",
      email: "self@example.invalid",
      full_name: null,
      is_active: true,
      is_superuser: true,
    },
    ...Array.from({ length: count }, (_, i) => ({
      id: `user-${i + 1}`,
      email: `user${i + 1}@example.invalid`,
      full_name: `用户${i + 1}`,
      is_active: true,
      is_superuser: false,
    })),
  ]
  const samples = Array.from({ length: count }, (_, i) => ({
    id: `sample-${i + 1}`,
    brand_id: brand,
    excerpt: `样本${i + 1}`,
    char_count: 0,
    source_url: null,
    note: null,
    created_at: null,
  }))
  const datasets = Array.from({ length: count }, (_, i) => ({
    id: `dataset-${i + 1}`,
    name: `评测集${i + 1}`,
    brand_id: brand,
    kind: "generation",
    version: 1,
    case_count: 0,
    created_at: null,
    group_id: `group-${i + 1}`,
    content_hash: "fixture",
  }))
  const removedUsers = new Set<string>()
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const paginate = (items: unknown[]) => {
      const p = Number(url.searchParams.get("page") ?? 1),
        size = Number(url.searchParams.get("page_size") ?? 20)
      return route.fulfill({
        json: {
          items: items.slice((p - 1) * size, p * size),
          total: items.length,
          page: p,
          page_size: size,
        },
      })
    }
    if (path.endsWith("/users/me"))
      return route.fulfill({ json: { ...users[0], is_superuser: !editor } })
    if (path === "/api/v1/brands")
      return route.fulfill({
        json: {
          items: [
            {
              id: brand,
              name: "回归品牌",
              category: "perfume",
              role: editor ? "editor" : "admin",
            },
          ],
        },
      })
    if (request.method() !== "GET") {
      const id = path.includes("/archive")
        ? path.split("/").slice(-2)[0]
        : (path.split("/").pop() ?? "")
      state.active++
      state.maxActive = Math.max(state.active, state.maxActive)
      state.calls.push({
        id,
        path,
        body: request.postData() ? request.postDataJSON() : null,
      })
      await state.wait
      await new Promise((resolve) => setTimeout(resolve, 60))
      state.active--
      if (state.fail.has(id))
        return route.fulfill({
          status: 500,
          json: {
            error: {
              code: "ERROR",
              message: "请求失败",
              details: {},
              request_id: `failed-${id}`,
            },
          },
        })
      if (id.startsWith("product"))
        state.products.find((row) => row.id === id)!.status = "archived"
      if (id.startsWith("rule"))
        state.rules.find((row) => row.id === id)!.enabled = false
      if (id.startsWith("user")) removedUsers.add(id)
      return route.fulfill({
        status: path.includes("/users/") ? 204 : 200,
        json: path.includes("/users/") ? undefined : {},
      })
    }
    if (path === "/api/v1/users/")
      return route.fulfill({
        json: {
          data: users
            .filter((row) => !removedUsers.has(row.id))
            .slice(
              Number(url.searchParams.get("skip") ?? 0),
              Number(url.searchParams.get("skip") ?? 0) +
                Number(url.searchParams.get("limit") ?? 100),
            ),
          count: users.length - removedUsers.size,
        },
      })
    if (path.endsWith("/viral-samples")) return paginate(samples)
    if (path.endsWith("/patterns")) return paginate([])
    if (path.endsWith("/products"))
      return paginate(
        state.products.filter(
          (row) => row.status === (url.searchParams.get("status") ?? "active"),
        ),
      )
    if (path === "/api/v1/compliance-rules") return paginate(state.rules)
    if (path === "/api/v1/evaluation/datasets")
      return route.fulfill({ json: { items: datasets } })
    return route.fulfill({
      json: { items: [], total: 0, page: 1, page_size: 20 },
    })
  })
  return state
}

test.describe("R6 table standards", () => {
  for (const [path, name] of [
    ["/admin", "用户1"],
    ["/viral-samples", "样本1"],
    ["/products", "商品1"],
    ["/evaluation/datasets", "评测集1"],
    ["/compliance/rules", "规则1"],
  ]) {
    test(`${path} shares typography, selection and simple pager`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await fixture(page)
      await page.goto(path)
      const table = page.getByRole("table").last()
      await expect(table.getByText(name, { exact: true }).first()).toBeVisible()
      const style = await table
        .getByRole("columnheader")
        .nth(1)
        .evaluate((e) => ({
          size: getComputedStyle(e).fontSize,
          weight: getComputedStyle(e).fontWeight,
          color: getComputedStyle(e).color,
        }))
      expect(style.size).toBe("12px")
      expect(style.weight).toBe("600")
      const cell = table.getByRole("row").nth(1).getByRole("cell").nth(1)
      expect(await cell.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
        "14px",
      )
      expect(await cell.evaluate((e) => getComputedStyle(e).color)).not.toBe(
        style.color,
      )
      await expect(table).not.toContainText("—")
      if (path === "/admin") {
        const self = table
          .getByRole("row")
          .filter({ hasText: "self@example.invalid" })
        await expect(self.getByText("本人", { exact: true })).toBeVisible()
        await expect(self.getByRole("checkbox")).toBeDisabled()
      }
      await expect(
        page.getByText(/每页\s*\d+\s*条|\d+\s*\/\s*\d+\s*页/),
      ).toHaveCount(0)
      await table
        .getByRole("checkbox", { name: "全选本页", exact: true })
        .check()
      const firstPageCount =
        (await table.getByRole("row").count()) - (path === "/admin" ? 2 : 1)
      await expect(
        page.getByRole("button", {
          name: `已选 ${firstPageCount} 项`,
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByRole("button", { name: `已选 ${firstPageCount} 项`, exact: true })
        .click()
      await expect(
        page.getByRole("menuitem", { name: "全选本页", exact: true }),
      ).toBeVisible()
      if (path === "/evaluation/datasets")
        await expect(page.getByRole("menuitem", { name: /删除/ })).toHaveCount(
          0,
        )
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "下一页", exact: true }).click()
      await expect(
        table.getByRole("checkbox", { name: "全选本页", exact: true }),
      ).not.toBeChecked()
      await expect(
        page.getByRole("button", {
          name: `已选 ${firstPageCount} 项`,
          exact: true,
        }),
      ).toBeVisible()
      await page.getByRole("button", { name: "上一页", exact: true }).click()
      await expect(
        table.getByRole("checkbox", { name: "全选本页", exact: true }),
      ).toBeChecked()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({
        path: info.outputPath(`table-${path.replace(/\//g, "-")}-1280.png`),
        fullPage: true,
        animations: "disabled",
      })
    })
  }

  test("select all is bounded at 50 across pages and page deselection preserves other pages", async ({
    page,
  }) => {
    await fixture(page)
    await page.goto("/viral-samples")
    await page
      .getByRole("checkbox", { name: "选择 样本1", exact: true })
      .check()
    await page.getByRole("button", { name: "已选 1 项", exact: true }).click()
    await page
      .getByRole("menuitem", { name: "选择全部 61 条", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "已选 50 项", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "3", exact: true }).click()
    await expect(
      page.getByRole("checkbox", { name: "选择 样本51", exact: true }),
    ).toBeDisabled()
    for (let i = 41; i <= 50; i++)
      await page
        .getByRole("checkbox", { name: `选择 样本${i}`, exact: true })
        .uncheck()
    await expect(
      page.getByRole("button", { name: "已选 40 项", exact: true }),
    ).toBeVisible()
  })

  for (const [path, action, idPrefix] of [
    ["/products", "批量归档", "product"],
    ["/compliance/rules", "批量停用", "rule"],
  ]) {
    test(`${action} confirms and processes sequentially, preserves failures and retries only failed ids`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      const state = await fixture(page, 3)
      state.fail.add(`${idPrefix}-2`)
      await page.goto(path)
      await page
        .getByRole("checkbox", { name: "全选本页", exact: true })
        .check()
      await page.getByRole("button", { name: "已选 3 项", exact: true }).click()
      await page.getByRole("menuitem", { name: action, exact: true }).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toContainText("将逐条处理 3 项")
      expect(state.calls).toHaveLength(0)
      if (idPrefix === "rule") {
        await expect(
          dialog.getByRole("button", { name: "确认处理", exact: true }),
        ).toBeDisabled()
        await dialog
          .getByLabel("停用原因", { exact: true })
          .fill("回归测试停用")
      }
      await dialog
        .getByRole("button", { name: "确认处理", exact: true })
        .click()
      await expect(
        dialog.getByText(`failed-${idPrefix}-2`, { exact: true }),
      ).toBeVisible()
      await expect(dialog.getByText("处理成功", { exact: true })).toHaveCount(2)
      expect(state.maxActive).toBe(1)
      expect(state.calls).toHaveLength(3)
      if (idPrefix === "rule")
        expect(
          state.calls.every(
            (call) =>
              JSON.stringify(call.body) ===
              JSON.stringify({ enabled: false, reason: "回归测试停用" }),
          ),
        ).toBe(true)
      await dialog
        .getByRole("button", { name: "关闭", exact: true })
        .first()
        .click()
      await expect(
        page.getByRole("button", { name: "已选 1 项", exact: true }),
      ).toBeVisible()
      const failedName = idPrefix === "rule" ? "选择 规则2" : "选择 商品2"
      await expect(
        page.getByRole("checkbox", { name: failedName, exact: true }),
      ).toBeChecked()
      state.fail.clear()
      await page.getByRole("button", { name: "已选 1 项", exact: true }).click()
      await page.getByRole("menuitem", { name: action, exact: true }).click()
      if (idPrefix === "rule")
        await dialog.getByLabel("停用原因", { exact: true }).fill("重试")
      await dialog
        .getByRole("button", { name: "确认处理", exact: true })
        .click()
      await expect(dialog.getByText("处理成功", { exact: true })).toBeVisible()
      expect(state.calls.map((call) => call.id)).toEqual([
        `${idPrefix}-1`,
        `${idPrefix}-2`,
        `${idPrefix}-3`,
        `${idPrefix}-2`,
      ])
    })
  }

  test("one-page pager is absent and empty values stay blank while zero counts remain", async ({
    page,
  }) => {
    await fixture(page, 1)
    for (const path of [
      "/admin",
      "/products",
      "/evaluation/datasets",
      "/viral-samples",
      "/compliance/rules",
    ]) {
      await page.goto(path)
      await expect(page.getByRole("table")).toBeVisible()
      await expect(
        page.getByRole("navigation", { name: "分页", exact: true }),
      ).toHaveCount(0)
      await expect(page.getByRole("table")).not.toContainText("—")
      await expect(
        page.getByRole("cell", { name: "-", exact: true }),
      ).toHaveCount(0)
      if (path === "/viral-samples" || path === "/evaluation/datasets")
        await expect(
          page.getByRole("cell", { name: "0", exact: true }).first(),
        ).toBeVisible()
    }
  })

  test("product detail omits unfilled note rows and editable controls expose pencil on hover", async ({
    page,
  }) => {
    await fixture(page, 1)
    await page.goto("/products")
    const edit = page.getByRole("button", { name: "编辑", exact: true })
    await edit.hover()
    await expect(edit.locator("svg")).toHaveCSS("opacity", "1")
    await page.getByRole("button", { name: "商品1", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).not.toContainText("—")
    await expect(dialog.getByText(/前调：|中调：|后调：/)).toHaveCount(0)
  })

  test("user batch deletion excludes current user, confirms count and can cancel", async ({
    page,
  }) => {
    const state = await fixture(page, 2)
    await page.goto("/admin")
    await page.getByRole("checkbox", { name: "全选本页", exact: true }).check()
    await page.getByRole("button", { name: "已选 2 项", exact: true }).click()
    await page.getByRole("menuitem", { name: "删除", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("将逐条处理 2 项")
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click()
    expect(state.calls).toHaveLength(0)
    await page.getByRole("button", { name: "已选 2 项", exact: true }).click()
    await page.getByRole("menuitem", { name: "删除", exact: true }).click()
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click()
    await expect(dialog.getByText("处理成功", { exact: true })).toHaveCount(2)
    expect(state.calls.map((call) => call.id)).toEqual(["user-1", "user-2"])
    expect(state.maxActive).toBe(1)
  })

  test("members have no product or rule batch write controls", async ({
    page,
  }) => {
    const state = await fixture(page, 2, true)
    for (const path of ["/products", "/compliance/rules"]) {
      await page.goto(path)
      await expect(page.getByRole("table")).toBeVisible()
      await expect(page.getByRole("checkbox")).toHaveCount(0)
      await expect(page.getByRole("button", { name: /已选/ })).toHaveCount(0)
    }
    expect(state.calls).toHaveLength(0)
  })

  test("all failed archives keep selection without success toast and pending batch cannot close or repeat", async ({
    page,
  }) => {
    const state = await fixture(page, 2)
    state.fail.add("product-1")
    state.fail.add("product-2")
    let release: () => void = () => {}
    state.wait = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.goto("/products")
    await page.getByRole("checkbox", { name: "全选本页", exact: true }).check()
    await page.getByRole("button", { name: "已选 2 项", exact: true }).click()
    await page.getByRole("menuitem", { name: "批量归档", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click()
    await expect(
      dialog.getByRole("button", { name: "正在处理…", exact: true }),
    ).toBeDisabled()
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }),
    ).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeVisible()
    expect(state.calls).toHaveLength(1)
    release()
    await expect(
      dialog.getByText("failed-product-2", { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByText("处理成功", { exact: true })).toHaveCount(0)
    await expect(page.getByText("已保存", { exact: true })).toHaveCount(0)
    state.fail.clear()
    await dialog
      .getByRole("button", { name: "重试失败项", exact: true })
      .click()
    await expect(dialog.getByText("处理成功", { exact: true })).toHaveCount(2)
    expect(state.calls.map((call) => call.id)).toEqual([
      "product-1",
      "product-2",
      "product-1",
      "product-2",
    ])
    expect(state.maxActive).toBe(1)
  })
})
