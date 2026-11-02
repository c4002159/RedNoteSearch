import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const brand = "11111111-1111-4111-8111-111111111111"
const id = (n: number) =>
  `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`
function makeDocument(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: id(n),
    brand_id: brand,
    group_id: id(n + 100),
    title: `资料${n}`,
    source_kind: "file",
    source_description: null as string | null,
    doc_type: "sample_note",
    status: "approved",
    index_status: "ready",
    version: 1,
    is_current: true,
    source_filename: `source${n}.txt`,
    submitted_by: "user",
    submitted_by_name: "测试成员",
    created_at: "2026-11-01T00:00:00Z",
    ...extra,
  }
}
async function fixture(
  page: Page,
  options: {
    role?: string
    mode?: "conflict" | "repeat" | "503"
    unavailable?: boolean
    many?: boolean
    noteStatus?: number
    emptyProduct?: boolean
  } = {},
) {
  const state = {
    documents: [
      makeDocument(1, {
        title: "较旧来源",
        created_at: "2026-10-01T00:00:00Z",
      }),
      makeDocument(2, {
        title: "最新来源",
        created_at: "2026-11-02T00:00:00Z",
      }),
      makeDocument(3, {
        title: "待审临时来源",
        source_kind: "note",
        source_description: "成员甲，2026 年 11 月会议",
        status: "pending_review",
        index_status: "pending",
        is_current: false,
        source_filename: null,
      }),
      makeDocument(4, {
        title: "待审文件",
        status: "pending_review",
        index_status: "pending",
        is_current: false,
      }),
    ],
    reviews: [] as Record<string, unknown>[],
    notes: [] as Record<string, unknown>[],
    versions: [] as Record<string, unknown>[],
    previews: 0,
    listQueries: [] as URLSearchParams[],
    productWrites: 0,
  }
  if (options.many)
    state.documents.push(
      ...Array.from({ length: 21 }, (_, n) => makeDocument(n + 20)),
    )
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "fixture-token")
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const fail = (
      status: number,
      code = "ERROR",
      details: Record<string, unknown> = {},
    ) =>
      route.fulfill({
        status,
        json: {
          error: {
            code,
            message: status === 409 ? "内容相近，请核对" : "请求失败",
            details,
            request_id: `kb-${status}`,
          },
        },
      })
    if (path.endsWith("/users/me"))
      return route.fulfill({
        json: {
          id: "user",
          email: "fixture@example.invalid",
          full_name: "测试成员",
          is_active: true,
          is_superuser: true,
        },
      })
    if (path === "/api/v1/brands")
      return route.fulfill({
        json: {
          items: [
            {
              id: brand,
              name: "测试品牌",
              category: "perfume",
              role: options.role ?? "admin",
            },
          ],
        },
      })
    if (path.endsWith("/knowledge-notes")) {
      const body = request.postDataJSON()
      state.notes.push(body)
      if (options.noteStatus) return fail(options.noteStatus)
      const row = makeDocument(90, {
        ...body,
        source_kind: "note",
        source_filename: null,
        status: "pending_review",
        index_status: "pending",
        is_current: false,
      })
      state.documents.push(row)
      return route.fulfill({ status: 201, json: row })
    }
    if (path.endsWith("/knowledge-documents")) {
      state.listQueries.push(url.searchParams)
      let rows = state.documents.filter(
        (row) =>
          (!url.searchParams.get("status") ||
            row.status === url.searchParams.get("status")) &&
          (!url.searchParams.get("source_kind") ||
            row.source_kind === url.searchParams.get("source_kind")),
      )
      const total = rows.length,
        pageNumber = Number(url.searchParams.get("page") || 1),
        size = Number(url.searchParams.get("page_size") || 20)
      rows = rows.slice((pageNumber - 1) * size, pageNumber * size)
      return route.fulfill({
        json: { items: rows, total, page: pageNumber, page_size: size },
      })
    }
    const matched = path.match(/\/knowledge-documents\/([^/]+)(?:\/(.*))?$/)
    if (matched) {
      const row = state.documents.find((item) => item.id === matched[1])!
      if (matched[2] === "chunks")
        return route.fulfill({
          json: {
            items: [
              { id: id(99), chunk_index: 0, content: "已有正文", metadata: {} },
            ],
            total: 1,
          },
        })
      if (matched[2] === "text-versions") {
        const body = request.postDataJSON()
        state.versions.push(body)
        const next = {
          ...row,
          ...body,
          id: id(91),
          version: row.version + 1,
          is_current: false,
          status: "pending_review",
          index_status: "pending",
        }
        state.documents.push(next)
        return route.fulfill({ status: 201, json: next })
      }
      if (matched[2] === "similarity-preview") {
        state.previews++
        return route.fulfill({
          json: options.unavailable
            ? {
                status: "unavailable",
                message: "相似检查暂不可用",
                items: [],
                token: null,
              }
            : {
                status: "ready",
                message: "内容相近，请核对",
                items: [
                  {
                    id: id(1),
                    title: "仅标题相同",
                    similarity: null,
                    reasons: ["title_match"],
                  },
                ],
                token: "preview-token",
              },
        })
      }
      if (matched[2] === "reviews") {
        const body = request.postDataJSON()
        state.reviews.push(body)
        if (body.action === "cancel") {
          if (
            [
              "similarity_token",
              "similar_decision",
              "related_document_ids",
            ].some((field) => field in body)
          )
            return fail(422)
          return route.fulfill({ json: row })
        }
        if (options.mode === "503") return fail(503)
        if (
          options.mode &&
          (!body.similar_decision ||
            (options.mode === "repeat" && body.similarity_token === "token-1"))
        ) {
          const repeated = !!body.similar_decision
          return fail(409, "KB_SIMILAR_CONTENT", {
            status: "ready",
            token: repeated ? "token-2" : "token-1",
            items: repeated
              ? [
                  {
                    id: id(5),
                    title: "后来出现的资料",
                    similarity: null,
                    reasons: ["title_match"],
                  },
                ]
              : [
                  {
                    id: id(1),
                    title: "仅标题相同",
                    similarity: null,
                    reasons: ["title_match"],
                  },
                  {
                    id: id(2),
                    title: "内容相近的资料",
                    similarity: 0.934,
                    reasons: ["content_near"],
                  },
                ],
          })
        }
        row.status = "approved"
        row.is_current = true
        row.index_status = "ready"
        return route.fulfill({ json: row })
      }
      return route.fulfill({
        json: {
          ...row,
          versions: state.documents.filter(
            (item) => item.group_id === row.group_id,
          ),
          reviews: [],
        },
      })
    }
    if (path.endsWith("/products"))
      return route.fulfill({
        json: {
          items: [
            {
              id: "product",
              brand_id: brand,
              name: "测试香水",
              product_line: "",
              category: "perfume",
              status: "active",
              notes: { top: [], middle: ["茉莉"], base: [] },
              selling_points: options.emptyProduct
                ? []
                : [
                    {
                      text: "花香",
                      source_document_id: null,
                      source_chunk_id: null,
                      evidence_status: "draft",
                    },
                  ],
              restricted_claims: [],
            },
          ],
          total: 1,
        },
      })
    if (path.includes("/products/") && request.method() !== "GET")
      state.productWrites++
    return route.fulfill({ json: { items: [], total: 0 } })
  })
  return state
}

async function beginReview(page: Page) {
  await page.getByRole("button", { name: "审核通过", exact: true }).click()
  await page.getByLabel("原因（必填）").fill("已核对资料来源")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "审核通过", exact: true })
    .click()
}

test.describe("R6 knowledge UI", () => {
  test("商品详情仅显示填写字段，不显示空香调、卖点标题和空前缀分隔符", async ({
    page,
  }) => {
    await fixture(page, { emptyProduct: true })
    await page.goto("/products")
    await page.getByRole("button", { name: "查看", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("中调：茉莉")).toBeVisible()
    await expect(dialog.getByText(/前调|后调|禁用声称/)).toHaveCount(0)
    await expect(
      dialog.getByRole("heading", { name: "卖点", exact: true }),
    ).toHaveCount(0)
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(
      "香水",
    )
  })

  test("商品来源最新在前，末尾可提交临时来源但不可选待审资料", async ({
    page,
  }) => {
    const state = await fixture(page)
    await page.goto("/products")
    await page.getByRole("button", { name: "编辑", exact: true }).click()
    await page
      .getByRole("button", { name: "关联已审核资料来源", exact: true })
      .click()
    const picker = page.getByRole("dialog", { name: "选择来源", exact: true })
    const select = picker.getByLabel("资料", { exact: true })
    await expect(select.locator("option")).toHaveText([
      "选择来源",
      "最新来源 · v1",
      "较旧来源 · v1",
      "添加临时来源",
    ])
    await select.selectOption("__add_note__")
    const dialog = page.getByRole("dialog", {
      name: "添加临时来源",
      exact: true,
    })
    await dialog.getByLabel("标题", { exact: true }).fill("会议口述")
    await dialog
      .getByLabel("来源说明", { exact: true })
      .fill("品牌成员甲，2026 年 11 月 3 日会议")
    await dialog.getByLabel("正文", { exact: true }).fill("会议记录文字")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      page.getByText("已提交，审核通过后才能作为证据", { exact: true }),
    ).toBeVisible()
    expect(state.notes).toEqual([
      {
        title: "会议口述",
        source_description: "品牌成员甲，2026 年 11 月 3 日会议",
        text: "会议记录文字",
        doc_type: "sample_note",
      },
    ])
    await expect(select.locator("option")).toHaveText([
      "选择来源",
      "最新来源 · v1",
      "较旧来源 · v1",
      "添加临时来源",
    ])
    await expect(select).toHaveValue("")
    await expect(
      picker.getByRole("button", { name: "选择来源", exact: true }),
    ).toBeDisabled()
    expect(state.productWrites).toBe(0)
  })

  test("来源分类先筛后分页，切换分类回到第一页", async ({ page }) => {
    const state = await fixture(page, { many: true })
    await page.goto("/knowledge")
    await expect(
      page.getByRole("cell", { name: "较旧来源", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "下一页", exact: true }).click()
    await expect
      .poll(() =>
        state.listQueries.some(
          (query) =>
            query.get("source_kind") === "file" && query.get("page") === "2",
        ),
      )
      .toBe(true)
    await page.getByRole("tab", { name: "临时来源", exact: true }).click()
    await expect(
      page.getByRole("cell", { name: "待审临时来源", exact: true }),
    ).toBeVisible()
    expect(
      state.listQueries[state.listQueries.length - 1]?.get("source_kind"),
    ).toBe("note")
    expect(state.listQueries[state.listQueries.length - 1]?.get("page")).toBe(
      "1",
    )
    await expect(
      page.getByRole("cell", { name: "较旧来源", exact: true }),
    ).toHaveCount(0)
  })

  test("临时来源字段校验和码点边界，品牌成员也只能提交待审", async ({
    page,
  }) => {
    const state = await fixture(page, { role: "editor" })
    await page.goto("/knowledge")
    await page.getByRole("tab", { name: "临时来源", exact: true }).click()
    await page
      .getByRole("button", { name: "添加临时来源", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(dialog.getByText("标题不能为空，最多 200 字。")).toBeVisible()
    await dialog.getByLabel("标题", { exact: true }).fill("标题")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(
      dialog.getByText("临时来源的来源说明不能为空，最多 1000 字。"),
    ).toBeVisible()
    await dialog.getByLabel("来源说明", { exact: true }).fill("源".repeat(1001))
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(
      dialog.getByText("来源说明最多 1000 字。", { exact: true }),
    ).toBeVisible()
    await dialog.getByLabel("来源说明", { exact: true }).fill("😀".repeat(1000))
    await dialog.getByLabel("正文", { exact: true }).fill("字".repeat(50001))
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(
      dialog.getByText("正文不能为空，最多 50000 字。"),
    ).toBeVisible()
    expect(state.notes).toHaveLength(0)
    await dialog.getByLabel("正文", { exact: true }).fill("字".repeat(50000))
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.documents[state.documents.length - 1]?.status).toBe(
      "pending_review",
    )
    expect(state.documents[state.documents.length - 1]?.is_current).toBe(false)
  })

  test("编辑生成待审版本，旧版仍当前，空提交及临时来源清空说明均被阻止", async ({
    page,
  }) => {
    const state = await fixture(page)
    await page.goto("/knowledge")
    await page
      .getByRole("row")
      .filter({ hasText: "较旧来源" })
      .getByRole("button", { name: "编辑", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(
      dialog.getByText("请至少修改标题、来源说明、正文或类型中的一项。"),
    ).toBeVisible()
    await dialog.getByLabel("标题", { exact: true }).fill("改后的来源标题")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(page.getByText("新版本待审核", { exact: true })).toBeVisible()
    expect(state.versions).toEqual([{ title: "改后的来源标题" }])
    await expect(
      page.getByRole("row").filter({ hasText: "较旧来源" }),
    ).toContainText("当前版本")
    await expect(
      page.getByRole("row").filter({ hasText: "改后的来源标题" }),
    ).not.toContainText("当前版本")
    await page.getByRole("tab", { name: "临时来源", exact: true }).click()
    await page
      .getByRole("row")
      .filter({ hasText: "待审临时来源" })
      .getByRole("button", { name: "编辑", exact: true })
      .click()
    await dialog.getByLabel("来源说明", { exact: true }).fill(" ")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(
      dialog.getByText("临时来源的来源说明不能为空，最多 1000 字。"),
    ).toBeVisible()
    expect(state.versions).toHaveLength(1)
  })

  test("相近预览只点击时请求，不为 null 相似度编数字", async ({ page }) => {
    const state = await fixture(page)
    await page.goto(`/knowledge/${id(3)}`)
    await expect(
      page.getByRole("button", { name: "检查相近资料", exact: true }),
    ).toBeEnabled()
    expect(state.previews).toBe(0)
    await page
      .getByRole("button", { name: "检查相近资料", exact: true })
      .click()
    await expect(page.getByText("仅标题相同", { exact: true })).toBeVisible()
    expect(state.previews).toBe(1)
    await expect(page.getByText("标题相同", { exact: true })).toBeVisible()
    await expect(page.getByText(/相似度：/)).toHaveCount(0)
  })

  for (const decision of ["coexist", "new_wins", "cancel"] as const)
    test(`409 审核决定 ${decision}，理由必填且请求体符合契约`, async ({
      page,
    }) => {
      const state = await fixture(page, { mode: "conflict" })
      await page.goto(`/knowledge/${id(3)}`)
      await beginReview(page)
      const dialog = page.getByRole("dialog", {
        name: "内容相近，请核对",
        exact: true,
      })
      await expect(
        dialog.getByText("相似度：0.934", { exact: true }),
      ).toBeVisible()
      await expect(dialog.getByText(/相似度：/)).toHaveCount(1)
      const label =
        decision === "coexist"
          ? "并存"
          : decision === "new_wins"
            ? "以新的为准"
            : "取消"
      await dialog.getByRole("radio", { name: label, exact: true }).check()
      const confirm =
        decision === "coexist"
          ? "确认并存"
          : decision === "new_wins"
            ? "确认以新的为准"
            : "提交取消"
      await dialog.getByRole("button", { name: confirm, exact: true }).click()
      await expect(dialog.getByText("请填写 1–500 字的理由。")).toBeVisible()
      expect(state.reviews).toHaveLength(1)
      await dialog
        .getByLabel("理由（必填，最多 500 字）")
        .fill("审核人的处理理由")
      if (decision === "new_wins") {
        await dialog.getByRole("button", { name: confirm, exact: true }).click()
        await expect(
          dialog.getByText("请勾选至少一份要停用的旧资料，最多 10 个。"),
        ).toBeVisible()
        await dialog
          .getByRole("checkbox", { name: "仅标题相同", exact: true })
          .check()
      }
      if (decision === "cancel")
        await expect(
          dialog.getByText(
            "取消不是驳回：只记录本次取消及理由，资料保持待审。",
          ),
        ).toBeVisible()
      await dialog.getByRole("button", { name: confirm, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const sent = state.reviews[state.reviews.length - 1]!
      expect(sent.action).toBe(decision === "cancel" ? "cancel" : "approve")
      expect(sent.reason).toBe("审核人的处理理由")
      if (decision !== "cancel") {
        expect(sent.similarity_token).toBe("token-1")
        expect(sent.similar_decision).toBe(decision)
        expect(sent.related_document_ids).toEqual(
          decision === "new_wins" ? [id(1)] : [],
        )
      } else {
        expect(sent).toEqual({ action: "cancel", reason: "审核人的处理理由" })
        for (const field of [
          "similarity_token",
          "similar_decision",
          "related_document_ids",
        ])
          expect(sent).not.toHaveProperty(field)
        expect(state.documents.find((row) => row.id === id(3))?.status).toBe(
          "pending_review",
        )
        await expect(
          page.getByText("已记录取消，资料保持待审", { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole("button", { name: "审核通过", exact: true }),
        ).toBeEnabled()
        await expect(
          page.getByText("待审核", { exact: true }).first(),
        ).toBeVisible()
      }
    })

  test("再次 409 更新 items/token 并清除旧选择和理由", async ({ page }) => {
    const state = await fixture(page, { mode: "repeat" })
    await page.goto(`/knowledge/${id(3)}`)
    await beginReview(page)
    let dialog = page.getByRole("dialog")
    await dialog.getByRole("radio", { name: "以新的为准", exact: true }).check()
    await dialog
      .getByRole("checkbox", { name: "仅标题相同", exact: true })
      .check()
    await dialog.getByLabel("理由（必填，最多 500 字）").fill("第一次理由")
    await dialog.getByRole("button", { name: "确认以新的为准" }).click()
    dialog = page.getByRole("dialog")
    await expect(
      dialog.getByText("后来出现的资料", { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByText("仅标题相同", { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel("理由（必填，最多 500 字）")).toHaveValue("")
    await expect(
      dialog.getByRole("radio", { name: "并存", exact: true }),
    ).toBeChecked()
    await dialog.getByRole("radio", { name: "以新的为准", exact: true }).check()
    await expect(dialog.getByRole("checkbox")).not.toBeChecked()
    await dialog
      .getByRole("checkbox", { name: "后来出现的资料", exact: true })
      .check()
    await dialog.getByLabel("理由（必填，最多 500 字）").fill("第二次理由")
    await dialog.getByRole("button", { name: "确认以新的为准" }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.reviews[state.reviews.length - 1]?.similarity_token).toBe(
      "token-2",
    )
    expect(
      state.reviews[state.reviews.length - 1]?.related_document_ids,
    ).toEqual([id(5)])
  })

  test("预览 unavailable 仍可批准，入库 503 明确提示并保持待审", async ({
    page,
  }) => {
    const state = await fixture(page, { unavailable: true, mode: "503" })
    await page.goto(`/knowledge/${id(3)}`)
    await page
      .getByRole("button", { name: "检查相近资料", exact: true })
      .click()
    await expect(
      page.getByText("相似检查暂不可用", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "审核通过", exact: true }),
    ).toBeEnabled()
    await beginReview(page)
    await expect(
      page.getByText("资料暂不可入库，请稍后重试", { exact: true }),
    ).toBeVisible()
    await expect(page.getByText("kb-503", { exact: true })).toBeVisible()
    expect(state.documents.find((row) => row.id === id(3))?.status).toBe(
      "pending_review",
    )
    await expect(
      page.getByRole("button", { name: "审核通过", exact: true }),
    ).toBeEnabled()
  })

  test("非品牌 admin 不显示相近检查和审核按钮，审核队列无权限", async ({
    page,
  }) => {
    const state = await fixture(page, { role: "editor" })
    await page.goto(`/knowledge/${id(3)}`)
    await expect(
      page.getByRole("heading", { name: "待审临时来源", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "检查相近资料", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "审核通过", exact: true }),
    ).toHaveCount(0)
    expect(state.previews).toBe(0)
    await page.goto("/knowledge/review")
    await expect(page.getByText("没有权限查看这个页面")).toBeVisible()
  })

  test("预览不可用仍可成功批准，不要求相近处理决定", async ({ page }) => {
    const state = await fixture(page, { unavailable: true })
    await page.goto(`/knowledge/${id(3)}`)
    await page
      .getByRole("button", { name: "检查相近资料", exact: true })
      .click()
    await expect(
      page.getByText("相似检查暂不可用", { exact: true }),
    ).toBeVisible()
    await beginReview(page)
    await expect(
      page.getByRole("button", { name: "审核通过", exact: true }),
    ).toHaveCount(0)
    expect(state.reviews).toHaveLength(1)
    expect(state.reviews[0].similar_decision).toBeUndefined()
    expect(state.documents.find((row) => row.id === id(3))?.status).toBe(
      "approved",
    )
  })

  test("临时来源提交失败保留表单并显示请求编号", async ({ page }) => {
    const state = await fixture(page, { noteStatus: 500 })
    await page.goto("/knowledge")
    await page.getByRole("tab", { name: "临时来源", exact: true }).click()
    await page
      .getByRole("button", { name: "添加临时来源", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("标题", { exact: true }).fill("保留标题")
    await dialog
      .getByLabel("来源说明", { exact: true })
      .fill("成员甲，今天会议")
    await dialog.getByLabel("正文", { exact: true }).fill("保留正文")
    await dialog.getByRole("button", { name: "提交", exact: true }).click()
    await expect(dialog.getByText("kb-500", { exact: true })).toBeVisible()
    await expect(dialog.getByLabel("正文", { exact: true })).toHaveValue(
      "保留正文",
    )
    expect(state.notes).toHaveLength(1)
  })

  test("1280 宽下编辑与对比弹窗无页面溢出且没有脚本错误", async ({
    page,
  }, info) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await fixture(page, { mode: "conflict" })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/knowledge")
    await page
      .getByRole("row")
      .filter({ hasText: "较旧来源" })
      .getByRole("button", { name: "编辑", exact: true })
      .click()
    await expect(
      page.getByRole("dialog", { name: "编辑资料并创建新版本", exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath("edit-1280.png"),
      animations: "disabled",
    })
    await page.goto(`/knowledge/${id(3)}`)
    await beginReview(page)
    await expect(
      page.getByRole("dialog", { name: "内容相近，请核对", exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath("similarity-1280.png"),
      animations: "disabled",
    })
    expect(errors).toEqual([])
  })
})
