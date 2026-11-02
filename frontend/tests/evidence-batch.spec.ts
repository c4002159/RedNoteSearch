import { expect, type Page, test } from "@playwright/test"
import type { ClaimEvidencePublic } from "../src/client"
import { mockResult, resultIds, resultUrl } from "./utils/resultVisual"

test.use({ storageState: { cookies: [], origins: [] } })

function claims(): ClaimEvidencePublic[] {
  return [
    {
      id: "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
      version_id: resultIds.version,
      claim_text: "香气描述 A（演示）",
      status: "system_supported",
      source_level: "approved_kb",
      source_title: "自编资料（演示）",
      document_id: null,
      document_version: 1,
      chunk_id: null,
      snapshot_id: null,
      quote: "香气描述 A",
      rationale: "自编回归材料",
      human_confirmed: null,
      confirm_note: null,
      confirmed_at: null,
    },
    {
      id: "ccccccc2-cccc-4ccc-8ccc-cccccccccccc",
      version_id: resultIds.version,
      claim_text: "需要人工判断 B（演示）",
      status: "needs_human_review",
      source_level: null,
      document_id: null,
      document_version: null,
      chunk_id: null,
      snapshot_id: null,
      quote: null,
      rationale: "缺少足够来源",
      human_confirmed: null,
      confirm_note: null,
      confirmed_at: null,
    },
    {
      id: "ccccccc3-cccc-4ccc-8ccc-cccccccccccc",
      version_id: resultIds.version,
      claim_text: "先前已判断 C（演示）",
      status: "evidence_missing",
      source_level: null,
      document_id: null,
      document_version: null,
      chunk_id: null,
      snapshot_id: null,
      quote: null,
      rationale: "没有来源",
      human_confirmed: true,
      confirm_note: "原人工备注（演示）",
      confirmed_at: "2026-11-02T00:00:00Z",
    },
  ]
}

async function setup(
  page: Page,
  options: { historical?: boolean; flow?: string } = {},
) {
  const state = await mockResult(page, { evidence: claims(), ...options })
  const calls: {
    items: { evidence_id: string; human_confirmed: boolean; note?: string }[]
  }[] = []
  await page.route(
    "**/api/v1/generation-versions/*/evidence/confirm-batch",
    async (route) => {
      const body = route.request().postDataJSON()
      calls.push(body)
      state.evidence = state.evidence.map((item) => {
        const decision = body.items.find(
          (row: { evidence_id: string }) => row.evidence_id === item.id,
        )
        return decision
          ? {
              ...item,
              human_confirmed: decision.human_confirmed,
              confirm_note: decision.note ?? null,
            }
          : item
      })
      await route.fulfill({
        json: {
          items: state.evidence.filter((item) =>
            body.items.some(
              (decision: { evidence_id: string }) =>
                decision.evidence_id === item.id,
            ),
          ),
        },
      })
    },
  )
  return { state, calls }
}

test("Rejecting all excludes system supported claims and retains every system status", async ({
  page,
}) => {
  const { state, calls } = await setup(page)
  const statuses = state.evidence.map((item) => item.status)
  await page.goto(resultUrl)
  await page
    .getByRole("button", { name: "全部判为不成立", exact: true })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "将需要人工决定的断言全部判为不成立？",
    exact: true,
  })
  await expect(dialog).toContainText("覆盖本版已有的人工判断")
  await expect(dialog).not.toContainText("香气描述 A（演示）")
  await expect(dialog.getByRole("listitem")).toHaveCount(2)
  expect(calls).toEqual([])
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(calls).toEqual([])
  await page
    .getByRole("button", { name: "全部判为不成立", exact: true })
    .click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认全部不成立", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({
    items: claims()
      .filter((item) => item.status !== "system_supported")
      .map((item) => ({
        evidence_id: item.id,
        human_confirmed: false,
      })),
  })
  expect(state.evidence.map((item) => item.status)).toEqual(statuses)
  expect(
    state.evidence
      .filter((item) => item.status !== "system_supported")
      .every((item) => item.human_confirmed === false),
  ).toBe(true)
  await expect(page.getByText("人工判定：不成立", { exact: true })).toHaveCount(
    2,
  )
  expect(state.evidence[0].human_confirmed).toBeNull()
  await expect(page.getByText("系统判定支持", { exact: true })).toBeVisible()
})

test("Positive decisions require individual checkboxes and a note; no all-positive shortcut exists", async ({
  page,
}) => {
  const { state, calls } = await setup(page)
  await page.goto(resultUrl)
  await expect(page.getByRole("checkbox")).toHaveCount(3)
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked()
  await expect(
    page.getByRole("button", { name: "全部成立", exact: true }),
  ).toHaveCount(0)
  const accept = page.getByRole("button", {
    name: "把选中的判为成立",
    exact: true,
  })
  await expect(accept).toBeDisabled()
  await page
    .getByRole("checkbox", {
      name: "选择断言：需要人工判断 B（演示）",
      exact: true,
    })
    .check()
  await accept.click()
  const dialog = page.getByRole("dialog", {
    name: "确认选中的断言成立",
    exact: true,
  })
  await expect(dialog).toContainText("人工确认，不是系统验证")
  await expect(dialog).toContainText("需要人工判断 B（演示）")
  await expect(dialog).not.toContainText("香气描述 A（演示）")
  const confirm = dialog.getByRole("button", {
    name: "确认选中的成立",
    exact: true,
  })
  await expect(confirm).toBeDisabled()
  await dialog
    .getByLabel("判断备注（必填）", { exact: true })
    .fill("已逐项人工核对自编材料（演示）")
  await expect
    .poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1")
  await page.screenshot({
    path: test.info().outputPath("evidence-selection-note.png"),
  })
  await confirm.click()
  await expect(dialog).toHaveCount(0)
  expect(calls).toEqual([
    {
      items: [
        {
          evidence_id: claims()[1].id,
          human_confirmed: true,
          note: "已逐项人工核对自编材料（演示）",
        },
      ],
    },
  ])
  expect(state.evidence[1].status).toBe("needs_human_review")
  expect(state.evidence[0].human_confirmed).toBeNull()
  await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked()
  await expect(accept).toBeDisabled()
})

test("All supported claims disable reject-all but can still be individually confirmed positive", async ({
  page,
}) => {
  const { state, calls } = await setup(page)
  state.evidence = [claims()[0]]
  await page.goto(resultUrl)
  await expect(
    page.getByRole("button", { name: "全部判为不成立", exact: true }),
  ).toBeDisabled()
  await page
    .getByRole("checkbox", {
      name: "选择断言：香气描述 A（演示）",
      exact: true,
    })
    .check()
  await page
    .getByRole("button", { name: "把选中的判为成立", exact: true })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("香气描述 A（演示）")
  await dialog
    .getByLabel("判断备注（必填）", { exact: true })
    .fill("逐条核对，保留系统支持状态（演示）")
  await dialog
    .getByRole("button", { name: "确认选中的成立", exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  expect(calls[0].items).toEqual([
    {
      evidence_id: claims()[0].id,
      human_confirmed: true,
      note: "逐条核对，保留系统支持状态（演示）",
    },
  ])
  expect(state.evidence[0].status).toBe("system_supported")
})

test("A failed batch keeps the note and selection for retry and never changes local decisions", async ({
  page,
}) => {
  const { state, calls } = await setup(page)
  const before = structuredClone(state.evidence)
  const failure = "**/api/v1/generation-versions/*/evidence/confirm-batch"
  await page.route(failure, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: {
          code: "NOT_FOUND",
          message: "Evidence not found",
          request_id: "batch-evidence-fixture",
        },
      },
    }),
  )
  await page.goto(resultUrl)
  await page
    .getByRole("checkbox", {
      name: "选择断言：需要人工判断 B（演示）",
      exact: true,
    })
    .check()
  await page
    .getByRole("button", { name: "把选中的判为成立", exact: true })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "确认选中的断言成立",
    exact: true,
  })
  await dialog
    .getByLabel("判断备注（必填）", { exact: true })
    .fill("人工说明（演示）")
  await dialog
    .getByRole("button", { name: "确认选中的成立", exact: true })
    .click()
  await expect(dialog.getByRole("alert")).toContainText(
    "batch-evidence-fixture",
  )
  await expect(dialog.getByRole("alert")).not.toContainText(
    "Evidence not found",
  )
  await expect(
    dialog.getByLabel("判断备注（必填）", { exact: true }),
  ).toHaveValue("人工说明（演示）")
  expect(state.evidence).toEqual(before)
  expect(calls).toEqual([])
  await expect(page).toHaveURL(resultUrl)
})

test("A brand editor can record human decisions through the same member endpoint", async ({
  page,
}) => {
  const { calls } = await setup(page)
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "editor-fixture",
        email: "editor@example.invalid",
        full_name: "编辑者（演示）",
        is_superuser: false,
        is_active: true,
      },
    }),
  )
  await page.route("**/api/v1/brands", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "香氛品牌（演示）",
            category: "perfume",
            role: "editor",
          },
        ],
      },
    }),
  )
  await page.goto(resultUrl)
  await page
    .getByRole("checkbox", {
      name: "选择断言：需要人工判断 B（演示）",
      exact: true,
    })
    .check()
  await page
    .getByRole("button", { name: "把选中的判为成立", exact: true })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "确认选中的断言成立",
    exact: true,
  })
  await dialog
    .getByLabel("判断备注（必填）", { exact: true })
    .fill("编辑者逐条核对（演示）")
  await dialog
    .getByRole("button", { name: "确认选中的成立", exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  expect(calls).toHaveLength(1)
})

test("The note uses the 500 code point limit and the dialog blocks duplicate submission", async ({
  page,
}) => {
  await setup(page)
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await page.route(
    "**/api/v1/generation-versions/*/evidence/confirm-batch",
    async (route) => {
      calls++
      await pending
      await route.fulfill({
        status: 403,
        json: {
          error: {
            code: "FORBIDDEN",
            message: "没有权限",
            request_id: "batch-pending-fixture",
          },
        },
      })
    },
  )
  await page.goto(resultUrl)
  await page
    .getByRole("checkbox", {
      name: "选择断言：需要人工判断 B（演示）",
      exact: true,
    })
    .check()
  await page
    .getByRole("button", { name: "把选中的判为成立", exact: true })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "确认选中的断言成立",
    exact: true,
  })
  const note = dialog.getByLabel("判断备注（必填）", { exact: true })
  const confirm = dialog.getByRole("button", {
    name: "确认选中的成立",
    exact: true,
  })
  await note.fill("字".repeat(501))
  await expect(confirm).toBeDisabled()
  await note.fill("🌿".repeat(500))
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(note).toBeDisabled()
  await expect(confirm).toBeDisabled()
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  expect(calls).toBe(1)
  release?.()
  await expect(dialog).toContainText("batch-pending-fixture")
})

test("Historical and checking versions cannot start batch decisions", async ({
  page,
}) => {
  await setup(page, { historical: true })
  await page.goto(resultUrl)
  await expect(page.getByText("历史版本", { exact: true })).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "全部判为不成立", exact: true }),
  ).toHaveCount(0)
  await setup(page, { flow: "checking" })
  await page.reload()
  await expect(page.getByText("检查中", { exact: true })).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "把选中的判为成立", exact: true }),
  ).toHaveCount(0)
})
