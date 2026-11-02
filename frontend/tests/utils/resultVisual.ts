import type { Page } from "@playwright/test"
import type {
  ClaimEvidencePublic,
  ComplianceCheckPublic,
  GenerationVersionPublic,
  TaskPublic,
} from "../../src/client"
import { analysisIds, mockAnalysis } from "./analysisVisual"

export const resultIds = {
  task: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  next: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}
export const resultUrl = `/tasks/${resultIds.task}/versions/${resultIds.version}`
export const resultVersion: GenerationVersionPublic = {
  id: resultIds.version,
  task_id: resultIds.task,
  version_no: 1,
  parent_version_id: null,
  origin: "generated",
  flow_status: "needs_human_review",
  title_candidates: ["日常香气（演示）"],
  body: "日常里的香气片段（演示），只作为界面测试文字。",
  hashtags: ["日常香氛", "气味分享"],
  cover_candidates: ["香气片段"],
  constraint_checks: { passed: true, issues: [], counts: {} },
  retrieved_sources: [],
  template_version: 1,
  prompt_version: "fixture",
  voice_version: 1,
  checker_version: "fixture",
  model: "demo-model",
  selected_title_index: null,
  selected_cover_index: null,
  confirmed_at: null,
  created_at: "2026-11-02T00:00:00Z",
}
export const resultRisks: ComplianceCheckPublic[] = [
  {
    id: "risk-a",
    version_id: resultIds.version,
    rule_id: null,
    rule_version: 1,
    layer: "lexicon",
    rule_type: "keyword",
    severity: "block",
    field: "body",
    span: [0, 2],
    matched_text: "育发",
    suggestion: "只描述香气与使用场景，不写头发生长效果",
    source_name: "自编规则（演示）",
    source_clause: null,
    region_scope: null,
    basis: null,
    resolved: false,
    resolved_note: null,
  },
  {
    id: "risk-b",
    version_id: resultIds.version,
    rule_id: null,
    rule_version: 1,
    layer: "lexicon",
    rule_type: "keyword",
    severity: "warn",
    field: "body",
    span: [3, 5],
    matched_text: "绝对",
    suggestion: "改为有范围的客观描述",
    source_name: "自编规则（演示）",
    source_clause: null,
    region_scope: null,
    basis: null,
    resolved: false,
    resolved_note: null,
  },
  {
    id: "risk-c",
    version_id: resultIds.version,
    rule_id: null,
    rule_version: 1,
    layer: "lexicon",
    rule_type: "keyword",
    severity: "warn",
    field: "body",
    span: [6, 8],
    matched_text: "永久",
    suggestion: "不写无来源的时效承诺",
    source_name: "自编规则（演示）",
    source_clause: null,
    region_scope: null,
    basis: null,
    resolved: true,
    resolved_note: "先前人工处理（演示）",
  },
]

export async function mockResult(
  page: Page,
  options: {
    risks?: ComplianceCheckPublic[]
    evidence?: ClaimEvidencePublic[]
    flow?: string
    historical?: boolean
    tags?: string[]
  } = {},
) {
  await mockAnalysis(page)
  const state = {
    risks: options.risks ?? resultRisks.map((row) => ({ ...row })),
    evidence: options.evidence ?? [],
    version: {
      ...resultVersion,
      flow_status: options.flow ?? resultVersion.flow_status,
      hashtags: options.tags ?? resultVersion.hashtags,
    },
    latest: options.historical ? resultIds.next : resultIds.version,
    writes: [] as { path: string; body: Record<string, unknown> }[],
  }
  await page.route(`**/api/v1/tasks/${resultIds.task}`, (route) => {
    const task: TaskPublic = {
      id: resultIds.task,
      brand_id: analysisIds.brand,
      product_id: "product-fixture",
      scenario_id: "scenario-fixture",
      style: {},
      brief: "界面回归（演示）",
      required_terms: [],
      flow_status: "needs_human_review",
      progress: {},
      latest_version_id: state.latest,
      last_error: null,
      created_at: "2026-11-02T00:00:00Z",
    }
    return route.fulfill({ json: task })
  })
  await page.route("**/api/v1/generation-versions/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "POST" && path.endsWith("/rewrite")) {
      state.writes.push({ path, body: route.request().postDataJSON() })
      state.latest = resultIds.next
      return route.fulfill({
        status: 202,
        json: {
          ...state.version,
          id: resultIds.next,
          parent_version_id: resultIds.version,
          version_no: 2,
          origin: "rewritten",
        },
      })
    }
    if (route.request().method() !== "GET") return route.fallback()
    if (path.endsWith("/evidence"))
      return route.fulfill({ json: { items: state.evidence } })
    if (path.endsWith("/compliance"))
      return route.fulfill({
        json: {
          items: state.risks,
          unresolved_block: state.risks.filter(
            (row) => row.severity === "block" && !row.resolved,
          ).length,
        },
      })
    if (path.endsWith(`/${resultIds.next}`))
      return route.fulfill({
        json: {
          ...state.version,
          id: resultIds.next,
          parent_version_id: resultIds.version,
          version_no: 2,
          origin: "rewritten",
        },
      })
    if (path.endsWith(`/${resultIds.version}`))
      return route.fulfill({ json: state.version })
    return route.fallback()
  })
  return state
}
