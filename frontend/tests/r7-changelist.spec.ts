import { expect, type Page, test } from "@playwright/test"
import type {
  ClaimEvidencePublic,
  GenerationVersionPublic,
} from "../src/client"
import {
  mockResult,
  resultIds,
  resultRisks,
  resultUrl,
} from "./utils/resultVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const queue = (page: Page) =>
  page.getByRole("region", { name: "修改清单", exact: true })
async function request(page: Page, part: string, instruction: string) {
  await page.getByLabel(`${part}修改要求`, { exact: true }).fill(instruction)
  await page
    .getByRole("button", { name: `加入${part}修改要求`, exact: true })
    .click()
}
async function setup(page: Page, failAt = 0) {
  const state = await mockResult(page, { risks: [] })
  const versions = new Map<string, GenerationVersionPublic>([
    [resultIds.version, state.version],
  ])
  const writes: { path: string; body: Record<string, unknown> }[] = []
  await page.route("**/api/v1/generation-versions/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "GET") {
      const version = versions.get(path.split("/").pop() ?? "")
      return version ? route.fulfill({ json: version }) : route.fallback()
    }
    const body = route.request().postDataJSON()
    writes.push({ path, body })
    if (writes.length === failAt)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "模型暂时不可用",
            request_id: "r7-failed",
          },
        },
      })
    expect(path.endsWith("/revise")).toBe(true)
    const parentId = path.split("/").slice(-2)[0]
    const parent = versions.get(parentId)!
    const id = `r7-version-${writes.length}`
    const next: GenerationVersionPublic = {
      ...parent,
      ...(body.edited_note ?? {}),
      id,
      parent_version_id: parentId,
      version_no: parent.version_no + 1,
      origin: "rewritten",
      flow_status: "needs_human_review",
    }
    state.latest = id
    versions.set(id, next)
    return route.fulfill({ json: next })
  })
  return { state, writes, versions }
}

test("Collect, inspect, undo and refresh preserve a version-scoped queue without requests", async ({
  page,
}) => {
  const state = await mockResult(page)
  await page.goto(resultUrl)
  await request(page, "标题", "标题用短句")
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "按建议改写", exact: true })
    .first()
    .click()
  await expect(
    queue(page).getByRole("region", { name: "标题修改清单" }),
  ).toBeVisible()
  expect(state.writes).toEqual([])
  await page.reload()
  await expect(queue(page).locator("summary")).toHaveCount(2)
  await queue(page).getByText("改写要求", { exact: true }).click()
  await expect(queue(page)).toContainText("标题用短句")
  await queue(page)
    .getByRole("button", { name: "撤销：标题用短句", exact: true })
    .click()
  await expect(queue(page).locator("summary")).toHaveCount(1)
  await page.reload()
  await expect(queue(page).locator("summary")).toHaveCount(1)
  expect(state.writes).toEqual([])
})

test("One execution groups multiple same-target requirements and applies a global note", async ({
  page,
}) => {
  const { state, writes } = await setup(page)
  state.risks = resultRisks.slice(0, 2)
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page
    .getByRole("button", { name: "全部建议加入清单", exact: true })
    .click()
  await request(page, "正文", "保留客观描述")
  await request(page, "标题", "更简洁")
  await page.getByLabel("补充说明", { exact: true }).fill("使用温和语气")
  expect(writes).toEqual([])
  await page
    .getByRole("button", { name: "按以上全部改写", exact: true })
    .click()
  await expect(page).toHaveURL(/r7-version-1$/)
  expect(writes).toHaveLength(1)
  const parts = writes[0].body.parts as {
    target: string
    instruction: string
  }[]
  expect(parts.map((part) => part.target)).toEqual(["body", "titles"])
  expect(writes[0].path).toContain(resultIds.version)
  for (const risk of state.risks)
    expect(parts[0].instruction).toContain(risk.suggestion)
  expect(parts[0].instruction).toContain("保留客观描述")
  expect(writes[0].body.note).toBe("使用温和语气")
  for (const part of parts)
    expect(Array.from(part.instruction).length).toBeLessThanOrEqual(500)
  const saved = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`rednote:change-list:${id}`)!),
    resultIds.version,
  )
  expect(saved.items).toEqual([])
  expect(saved.note).toBe("")
})

test("Rejected evidence enters automatically, reversal removes it, immediate decision endpoint is retained", async ({
  page,
}) => {
  const evidence: ClaimEvidencePublic = {
    id: "claim-1",
    version_id: resultIds.version,
    claim_text: "测试断言",
    status: "evidence_missing",
    source_level: null,
    document_id: null,
    document_version: null,
    chunk_id: null,
    snapshot_id: null,
    quote: null,
    rationale: "需要人工判断",
    human_confirmed: null,
    confirm_note: null,
    confirmed_at: null,
  }
  const state = await mockResult(page, { evidence: [evidence], risks: [] })
  const decisions: unknown[] = []
  await page.route("**/api/v1/claim-evidence/*/confirm", async (route) => {
    const body = route.request().postDataJSON()
    decisions.push(body)
    state.evidence[0] = {
      ...state.evidence[0],
      human_confirmed: body.human_confirmed,
      confirm_note: body.note,
    }
    await route.fulfill({ json: state.evidence[0] })
  })
  await page.goto(resultUrl)
  await page.getByRole("button", { name: "不成立", exact: true }).click()
  await page
    .getByLabel("判断依据（必填）", { exact: true })
    .fill("这句话没有来源")
  await page.getByRole("button", { name: "确认不成立", exact: true }).click()
  await expect(
    queue(page).getByText("不成立的断言", { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    queue(page).getByText("不成立的断言", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "成立", exact: true }).click()
  await page
    .getByLabel("判断依据（必填）", { exact: true })
    .fill("人工重新核对后成立")
  await page.getByRole("button", { name: "确认成立", exact: true }).click()
  await expect(
    queue(page).getByText("不成立的断言", { exact: true }),
  ).toHaveCount(0)
  expect(decisions).toEqual([
    { human_confirmed: false, note: "这句话没有来源" },
    { human_confirmed: true, note: "人工重新核对后成立" },
  ])
  expect(state.writes).toEqual([])
})

for (const save of [false, true])
  test(`Manual edits ${save ? "saved to queue" : "still in editor"} precede model rewrites`, async ({
    page,
  }) => {
    const { writes } = await setup(page)
    await page.goto(resultUrl)
    await request(page, "标题", "标题更简洁")
    await page.getByRole("button", { name: "编辑", exact: true }).click()
    await page.getByLabel("正文", { exact: true }).fill("人工改好的正文")
    if (save) {
      await page
        .getByRole("button", { name: "保存编辑到清单", exact: true })
        .click()
      await page.reload()
    }
    expect(writes).toEqual([])
    await page
      .getByRole("button", { name: "按以上全部改写", exact: true })
      .click()
    await expect(page).toHaveURL(/r7-version-1$/)
    expect(writes.map((write) => write.path.split("/").pop())).toEqual([
      "revise",
    ])
    expect(writes[0].body.edited_note).toMatchObject({ body: "人工改好的正文" })
    expect(writes[0].path).toContain(resultIds.version)
    expect(writes[0].body.parts).toEqual([
      { target: "titles", instruction: "标题更简洁" },
    ])
  })

test("Atomic failure retains every target across refresh and retries on the original parent", async ({
  page,
}) => {
  const { writes, versions } = await setup(page, 1)
  await page.goto(resultUrl)
  await request(page, "标题", "简洁标题")
  await request(page, "正文", "简洁正文")
  await page
    .getByRole("button", { name: "按以上全部改写", exact: true })
    .click()
  await expect(page.getByRole("alert")).toContainText("r7-failed")
  await expect(page).toHaveURL(resultUrl)
  expect(versions.size).toBe(1)
  await page.reload()
  await expect(queue(page).locator("summary")).toHaveCount(2)
  await page.getByRole("button", { name: "重试改写", exact: true }).click()
  await expect(page).toHaveURL(/r7-version-2$/)
  expect(writes).toHaveLength(2)
  expect(writes[0].body).toEqual(writes[1].body)
  expect(writes.every((write) => write.path.includes(resultIds.version))).toBe(
    true,
  )
  expect(versions.size).toBe(2)
  const persisted = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`rednote:change-list:${id}`)!),
    resultIds.version,
  )
  expect(persisted).not.toHaveProperty("progress")
})

for (const failure of [422, 503, "network"] as const)
  test(`Atomic ${failure} keeps all changes and shows Chinese failure`, async ({
    page,
  }) => {
    await mockResult(page, { risks: [] })
    await page.route("**/api/v1/generation-versions/*/revise", (route) =>
      failure === "network"
        ? route.abort("failed")
        : route.fulfill({
            status: failure,
            json: {
              error: {
                code: "FAILED",
                message: "模型返回无效内容，请重试",
                request_id: `r7-${failure}`,
              },
            },
          }),
    )
    await page.goto(resultUrl)
    await request(page, "正文", "保留我的要求")
    await page
      .getByRole("button", { name: "按以上全部改写", exact: true })
      .click()
    await expect(page.getByRole("alert")).toContainText(
      failure === "network" ? "网络连接失败" : `r7-${failure}`,
    )
    await expect(queue(page).locator("summary")).toHaveCount(1)
    await page.reload()
    await expect(queue(page).locator("summary")).toHaveCount(1)
    await expect(page).toHaveURL(resultUrl)
  })

test("History is read only, the confirmation appears only for an empty unblocked queue", async ({
  page,
}) => {
  const state = await mockResult(page, { risks: [] })
  await page.goto(resultUrl)
  await expect(
    page.getByRole("button", { name: "确认可复制", exact: true }),
  ).toBeVisible()
  await request(page, "标签", "只用具体标签")
  await expect(
    page.getByRole("button", { name: "确认可复制", exact: true }),
  ).toHaveCount(0)
  await queue(page)
    .getByRole("button", { name: "撤销：只用具体标签", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "确认可复制", exact: true }),
  ).toBeVisible()
  await request(page, "标题", "历史草稿不能执行")
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await page
    .getByLabel("正文", { exact: true })
    .fill("这份本地草稿不属于历史版本正文")
  await page
    .getByRole("button", { name: "保存编辑到清单", exact: true })
    .click()
  state.latest = resultIds.next
  await page.reload()
  await expect(page.getByText("历史版本", { exact: true })).toBeVisible()
  await expect(queue(page)).toHaveCount(0)
  await expect(
    page.getByText(state.version.body, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("这份本地草稿不属于历史版本正文", { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "按以上全部改写", exact: true }),
  ).toHaveCount(0)
})

test("Unavailable localStorage does not prevent collecting or executing", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem,
      write = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("rednote:change-list:"))
        throw new Error("storage blocked")
      return read.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("rednote:change-list:"))
        throw new Error("storage blocked")
      return write.call(this, key, value)
    }
  })
  await page.goto(resultUrl)
  await request(page, "标题", "缩短标题")
  await page
    .getByRole("button", { name: "按以上全部改写", exact: true })
    .click()
  await expect(page).toHaveURL(/r7-version-1$/)
  expect(writes).toHaveLength(1)
})

test("An overall note alone is sent once without inventing a part or an edit request", async ({
  page,
}) => {
  const { writes, versions } = await setup(page)
  await page.goto(resultUrl)
  await page.getByLabel("补充说明", { exact: true }).fill("整体更简洁")
  await page
    .getByRole("button", { name: "按以上全部改写", exact: true })
    .click()
  await expect(page).toHaveURL(/r7-version-1$/)
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toEqual({ parts: [], note: "整体更简洁" })
  expect(versions.size).toBe(2)
})

test("Invalid stored JSON is ignored and note length is enforced without losing it", async ({
  page,
}) => {
  await mockResult(page, { risks: [] })
  await page.addInitScript(
    (id) => localStorage.setItem(`rednote:change-list:${id}`, "{broken"),
    resultIds.version,
  )
  await page.goto(resultUrl)
  await expect(queue(page)).toBeVisible()
  await page.getByLabel("补充说明", { exact: true }).fill("🌿".repeat(501))
  await expect(page.getByRole("alert")).toContainText("补充说明不能超过 500 字")
  await expect(
    page.getByRole("button", { name: "按以上全部改写", exact: true }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`rednote:change-list:${id}`)!).note
          .length,
      resultIds.version,
    ),
  ).toBe(1002)
})

test("Manual-only revision is one request; cancel and undo do not write", async ({
  page,
}) => {
  const { writes } = await setup(page)
  await page.goto(resultUrl)
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await page.getByLabel("正文", { exact: true }).fill("取消这次编辑")
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(queue(page).locator("summary")).toHaveCount(0)
  expect(writes).toEqual([])
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await page.getByLabel("正文", { exact: true }).fill("撤销这次编辑")
  await page
    .getByRole("button", { name: "保存编辑到清单", exact: true })
    .click()
  await queue(page).getByRole("button", { name: "撤销", exact: true }).click()
  await expect(queue(page).locator("summary")).toHaveCount(0)
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await page.getByLabel("正文", { exact: true }).fill("只保存人工写好的正文")
  await page
    .getByRole("button", { name: "保存编辑到清单", exact: true })
    .click()
  expect(writes).toEqual([])
  await page
    .getByRole("button", { name: "按以上全部改写", exact: true })
    .click()
  await expect(page).toHaveURL(/r7-version-1$/)
  expect(writes.map((write) => write.path.split("/").pop())).toEqual(["revise"])
  expect(writes[0].path).toContain(resultIds.version)
})

test("Keeping a risk processed still uses the immediate endpoint and removes its queued suggestion", async ({
  page,
}) => {
  const state = await mockResult(page, { risks: [resultRisks[0]] })
  const writes: unknown[] = []
  await page.route("**/api/v1/compliance-checks/*/resolve", async (route) => {
    const body = route.request().postDataJSON()
    writes.push(body)
    state.risks[0] = {
      ...state.risks[0],
      resolved: true,
      resolved_note: body.note,
    }
    await route.fulfill({ json: state.risks[0] })
  })
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  await page.getByRole("button", { name: "按建议改写", exact: true }).click()
  await expect(queue(page).locator("summary")).toHaveCount(1)
  await page.getByRole("button", { name: "标记为已处理", exact: true }).click()
  await page
    .getByLabel("处理说明（必填）", { exact: true })
    .fill("保留并记录人工处理说明")
  await page
    .getByRole("button", { name: "标记为已处理", exact: true })
    .last()
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(queue(page).locator("summary")).toHaveCount(0)
  expect(writes).toEqual([{ note: "保留并记录人工处理说明" }])
  expect(state.writes).toEqual([])
})

for (const width of [1433, 1024, 720])
  test(`Change list groups remain readable without overflow at ${width}`, async ({
    page,
  }, info) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mockResult(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(resultUrl)
    await request(page, "标题", "把标题写得更简洁")
    await request(page, "正文", "只保留资料支持的描述")
    await page.getByLabel("补充说明", { exact: true }).fill("请保留温和的表达")
    await expect(queue(page).locator("summary")).toHaveCount(2)
    for (const summary of await queue(page).locator("summary").all())
      await summary.click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath(`change-list-${width}.png`),
      fullPage: true,
    })
    expect(errors).toEqual([])
  })

for (const completed of [true, false])
  test(`Interrupted revise reconciles task latest (completed=${completed}) before retry`, async ({
    page,
  }) => {
    const state = await mockResult(page, { risks: [] })
    let calls = 0
    await page.route(
      "**/api/v1/generation-versions/*/revise",
      async (route) => {
        calls += 1
        if (calls === 1) {
          if (completed) state.latest = resultIds.next
          return route.abort("timedout")
        }
        state.latest = resultIds.next
        return route.fulfill({
          json: {
            ...state.version,
            id: resultIds.next,
            parent_version_id: resultIds.version,
            version_no: 2,
            origin: "rewritten",
          },
        })
      },
    )
    await page.goto(resultUrl)
    await request(page, "正文", "中断后仍要保留的要求")
    await page.getByLabel("补充说明", { exact: true }).fill("整体说明")
    await page
      .getByRole("button", { name: "按以上全部改写", exact: true })
      .click()
    if (completed) {
      await expect(page).toHaveURL(new RegExp(`/${resultIds.next}$`))
      await expect(
        page.getByText("上次请求超时，但新版本已生成，已为你打开", {
          exact: true,
        }),
      ).toBeVisible()
      expect(calls).toBe(1)
      const saved = await page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`rednote:change-list:${id}`)!),
        resultIds.version,
      )
      expect(saved.items).toEqual([])
      expect(saved.note).toBe("")
      expect(saved.failure).toBeNull()
    } else {
      await expect(page.getByRole("alert")).toContainText("网络连接失败")
      await expect(page).toHaveURL(resultUrl)
      await expect(queue(page).locator("summary")).toHaveCount(1)
      await expect(page.getByLabel("补充说明", { exact: true })).toHaveValue(
        "整体说明",
      )
      await expect(
        page.getByRole("button", { name: "重试改写", exact: true }),
      ).toBeVisible()
      expect(calls).toBe(1)
      await page.reload()
      await expect(queue(page).locator("summary")).toHaveCount(1)
      await page.getByRole("button", { name: "重试改写", exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/${resultIds.next}$`))
      expect(calls).toBe(2)
    }
  })
