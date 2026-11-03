import { expect, type Page, test } from "@playwright/test"
import type { ClaimEvidencePublic } from "../src/client"
import {
  mockResult,
  resultIds,
  resultRisks,
  resultUrl,
} from "./utils/resultVisual"

test.use({ storageState: { cookies: [], origins: [] } })
const next = (page: Page) =>
  page.getByRole("region", { name: "下一步", exact: true })
const review = (page: Page) =>
  page.getByRole("region", { name: "检查与处理", exact: true })
function claim(id: string): ClaimEvidencePublic {
  return {
    id,
    version_id: resultIds.version,
    claim_text: `待判断断言 ${id}`,
    status: "evidence_missing",
    human_confirmed: null,
    source_level: null,
    document_id: null,
    document_version: null,
    chunk_id: null,
    snapshot_id: null,
    quote: null,
    rationale: "需要人工判断",
    confirm_note: null,
    confirmed_at: null,
  }
}
async function requirements(page: Page) {
  await page.getByLabel("标题修改要求", { exact: true }).fill("精简标题")
  await page
    .getByRole("button", { name: "加入标题修改要求", exact: true })
    .click()
}
for (const accepted of [true, false])
  test(`Evidence decision ${accepted} is collapsed and pending count decreases`, async ({
    page,
  }) => {
    const state = await mockResult(page, {
      evidence: [claim("claim-a"), claim("claim-b")],
      risks: [],
    })
    await page.route("**/api/v1/claim-evidence/*/confirm", async (route) => {
      const body = route.request().postDataJSON()
      state.evidence[0] = {
        ...state.evidence[0],
        human_confirmed: body.human_confirmed,
        confirm_note: body.note,
      }
      await route.fulfill({ json: state.evidence[0] })
    })
    await page.goto(resultUrl)
    await expect(
      page.getByRole("tab", { name: "证据 2 · 待判断 2", exact: true }),
    ).toBeVisible()
    const card = page.locator('[id="evidence-claim-a"]')
    await expect(card).toHaveAttribute("data-review-state", "pending")
    await card
      .getByRole("button", { name: accepted ? "成立" : "不成立", exact: true })
      .click()
    await page
      .getByLabel("判断依据（必填）", { exact: true })
      .fill("人工逐条核对的理由")
    await page
      .getByRole("button", {
        name: accepted ? "确认成立" : "确认不成立",
        exact: true,
      })
      .click()
    await expect(
      card.getByText(accepted ? "已判断：成立" : "已判断：不成立", {
        exact: true,
      }),
    ).toBeVisible()
    await expect(card.locator("details")).not.toHaveAttribute("open", "")
    await expect(
      card.getByText("人工确认（非系统验证）", { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "证据 2 · 待判断 1", exact: true }),
    ).toBeVisible()
    if (!accepted) {
      await expect(card.getByText("已加入清单", { exact: true })).toBeVisible()
      await expect(card).toHaveAttribute("data-review-state", "queued")
    } else await expect(card).toHaveAttribute("data-review-state", "done")
    await card.locator("summary").click()
    await expect(
      card.getByRole("button", { name: "重新判断", exact: true }),
    ).toBeVisible()
  })

test("Resolved risks collapse and all three filters show the correct cards; queue undo restores pending", async ({
  page,
}) => {
  const state = await mockResult(page, { risks: resultRisks.slice(0, 2) })
  await page.route("**/api/v1/compliance-checks/*/resolve", async (route) => {
    state.risks[0] = {
      ...state.risks[0],
      resolved: true,
      resolved_note: route.request().postDataJSON().note,
    }
    await route.fulfill({ json: state.risks[0] })
  })
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /风险/ }).click()
  const first = page.locator(`[id="risk-${resultRisks[0].id}"]`)
  const second = page.locator(`[id="risk-${resultRisks[1].id}"]`)
  await expect(
    review(page).getByRole("button", { name: "已处理", exact: true }),
  ).toHaveCount(0)
  await first.getByRole("button", { name: "标记为已处理", exact: true }).click()
  await page
    .getByLabel("处理说明（必填）", { exact: true })
    .fill("已经人工处理")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "标记为已处理", exact: true })
    .click()
  await expect(first.getByText("已处理", { exact: true })).toBeVisible()
  await expect(first.locator("details")).not.toHaveAttribute("open", "")
  await expect(
    page.getByRole("tab", { name: "风险 2 · 待处理 1", exact: true }),
  ).toBeVisible()
  await review(page)
    .getByRole("button", { name: "待处理", exact: true })
    .click()
  await expect(first).toHaveCount(0)
  await expect(second).toBeVisible()
  await second.getByRole("button", { name: "按建议改写", exact: true }).click()
  await expect(second).toHaveAttribute("data-review-state", "queued")
  await next(page)
    .getByRole("button", { name: "修改清单：1 项", exact: true })
    .click()
  await next(page)
    .getByRole("button", { name: /^撤销：/ })
    .click()
  await expect(second).toHaveAttribute("data-review-state", "pending")
  await review(page)
    .getByRole("button", { name: "已处理", exact: true })
    .click()
  await expect(first).toBeVisible()
  await expect(second).toHaveCount(0)
  await review(page).getByRole("button", { name: "全部", exact: true }).click()
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()
})

test("The first action stays fixed above expandable controls and one click submits one revise", async ({
  page,
}) => {
  const state = await mockResult(page, { risks: [] })
  await page.goto(resultUrl)
  const action = next(page).getByRole("button").first()
  await expect(action).toHaveText("确认可复制")
  await requirements(page)
  await expect(action).toHaveText("按清单改写（1 项）")
  const before = await action.boundingBox()
  const listToggle = next(page).getByText("已加入 1 项，点开查看、撤销", {
    exact: true,
  })
  await listToggle.click()
  await expect(
    next(page).getByRole("button", { name: /^撤销：/ }),
  ).toBeVisible()
  await next(page).getByText("补充说明（可选）", { exact: true }).click()
  await expect(page.getByLabel("补充说明", { exact: true })).toBeVisible()
  expect(await action.boundingBox()).toEqual(before)
  await next(page)
    .getByRole("button", { name: /^撤销：/ })
    .click()
  await expect(action).toHaveText("确认可复制")
  await requirements(page)
  await action.click()
  await expect(page).toHaveURL(new RegExp(`/${resultIds.next}$`))
  expect(state.writes).toHaveLength(1)
})

test("Blocker link and progress switch tabs, scroll, and focus the first pending card", async ({
  page,
}) => {
  await mockResult(page, {
    evidence: [claim("focus-claim")],
    risks: [resultRisks[0]],
  })
  await page.goto(resultUrl)
  await expect(next(page).getByRole("button").first()).toBeDisabled()
  await next(page).getByRole("button", { name: "去处理", exact: true }).click()
  await expect(page.getByRole("tab", { name: /风险/ })).toHaveAttribute(
    "data-state",
    "active",
  )
  await expect(page.locator(`[id="risk-${resultRisks[0].id}"]`)).toBeFocused()
  await next(page)
    .getByRole("button", { name: "断言：待判断 1", exact: true })
    .click()
  await expect(page.getByRole("tab", { name: /证据/ })).toHaveAttribute(
    "data-state",
    "active",
  )
  await expect(page.locator('[id="evidence-focus-claim"]')).toBeFocused()
  await expect
    .poll(
      async () =>
        (await page.locator('[id="evidence-focus-claim"]').boundingBox())!.y,
    )
    .toBeGreaterThanOrEqual(64)
})

for (const flow of ["edited_pending_recheck", "checking", "generating"])
  test(`Primary action follows existing flow ${flow}`, async ({ page }) => {
    await mockResult(page, { risks: [], flow })
    await page.goto(resultUrl)
    const action = next(page).getByRole("button").first()
    await expect(action).toHaveText(
      flow === "edited_pending_recheck" ? "重新检查" : "处理中…",
    )
    if (flow !== "edited_pending_recheck") await expect(action).toBeDisabled()
  })

for (const width of [1433, 1024, 720, 375])
  test(`Flow layout at ${width}px has a reachable single action and no overflow`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await mockResult(page, {
      evidence: Array.from({ length: 18 }, (_, i) => claim(`long-${i}`)),
      risks: [],
    })
    await page.goto(resultUrl)
    const mobile = page.getByRole("region", {
      name: "下一步快捷操作",
      exact: true,
    })
    if (width >= 1024) await expect(mobile).toBeHidden()
    else await expect(mobile).toBeVisible()
    await expect(
      page.getByRole("button", { name: "确认可复制", exact: true }),
    ).toHaveCount(1)
    await expect(
      page.getByRole("button", { name: "确认可复制", exact: true }),
    ).toBeDisabled()
    await page.locator('[id="evidence-long-17"]').scrollIntoViewIfNeeded()
    if (width >= 1024) {
      const box = (await next(page).boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(64)
      expect(box.y + box.height).toBeLessThanOrEqual(901)
      await expect(next(page).getByRole("button").first()).toBeInViewport()
    }
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    )
    if (width < 1024) {
      const last = (await page
        .locator('[id="evidence-long-17"]')
        .boundingBox())!
      const bar = (await mobile.boundingBox())!
      expect(last.y + last.height).toBeLessThanOrEqual(bar.y)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath(`flow-${width}.png`),
      fullPage: true,
    })
    await page.reload()
    await expect(review(page)).toBeVisible()
  })

for (const width of [1433, 375])
  test(`History has no action center or bottom action at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockResult(page, { historical: true })
    await page.goto(resultUrl)
    await expect(
      page.getByText("这是历史版本，只能查看。", { exact: true }),
    ).toBeVisible()
    await expect(next(page)).toHaveCount(0)
    await expect(
      page.getByRole("region", { name: "下一步快捷操作", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("region", { name: "修改清单", exact: true }),
    ).toHaveCount(0)
  })

test("The batch checkbox shares the first line of the claim and risk cards have no separate manual button", async ({
  page,
}) => {
  await mockResult(page, { evidence: [claim("claim-a")] })
  await page.goto(resultUrl)
  await page.getByRole("tab", { name: /^风险/ }).click()
  await expect(page.getByRole("button", { name: "我自己改" })).toHaveCount(0)
  await page.getByRole("tab", { name: /^证据/ }).click()
  const card = page.locator('[id="evidence-claim-a"]')
  const box = await card.getByRole("checkbox").boundingBox()
  const title = await card.getByText("待判断断言 claim-a").first().boundingBox()
  if (!box || !title) throw new Error("missing boxes")
  expect(box.x).toBeLessThan(title.x)
  expect(
    Math.abs(box.y + box.height / 2 - (title.y + title.height / 2)),
  ).toBeLessThan(6)
})
