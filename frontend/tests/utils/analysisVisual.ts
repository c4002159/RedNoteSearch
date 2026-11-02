import type { Page } from "@playwright/test"

export const analysisIds = {
  brand: "11111111-1111-4111-8111-111111111111",
  dataset: "22222222-2222-4222-8222-222222222222",
  run: "55555555-5555-4555-8555-555555555555",
  sample: "77777777-7777-4777-8777-777777777777",
  pattern: "88888888-8888-4888-8888-888888888888",
  result: "99999999-9999-4999-8999-999999999999",
}
const ids = analysisIds
const date = "2026-11-02T00:00:00Z"
export const visualDataset = {
  id: ids.dataset,
  name: "香氛表达（演示）",
  kind: "generation",
  brand_id: ids.brand,
  group_id: ids.dataset,
  version: 2,
  case_count: 1,
  content_hash: "fixture",
  created_at: date,
}
export const visualPattern = {
  id: ids.pattern,
  brand_id: ids.brand,
  sample_id: ids.sample,
  title_pattern: "生活场景切入（演示）",
  hook_type: "场景提问",
  tone: "轻松克制",
  emoji_usage: "少量点缀 🌿",
  hashtag_usage: "围绕使用场景",
  paragraph_structure: [
    "提出场景中的问题",
    "介绍个人感受与使用方式",
    "以开放问题收尾",
  ],
  abstract_template:
    "从日常场景引出香氛体验。\n{保留为普通文字} 🌿\n分享感受，不推断功效。",
  model_id: "demo-model",
  prompt_version: "viral-v1",
  checker_version: "checker-v1",
  created_at: date,
}
export const visualRun = {
  id: ids.run,
  dataset_id: ids.dataset,
  kind: "generation",
  status: "completed",
  sample_count: 1,
  versions: {
    dataset_version: 2,
    prompt_version: "v1",
    checker_version: "v1",
    rubric_version: "r1",
    models: ["demo-model"],
    baselines: [],
  },
  metrics: {
    "model:demo-model": [
      { name: "avg_cost", value: null, n: 1, definition: "价格未配置" },
    ],
  },
  failures: [],
  error: null,
  created_at: date,
  finished_at: date,
}
export const visualResult = {
  id: ids.result,
  case_index: 0,
  system: "model:demo-model",
  output: { body: "微风与香气（演示） 🌿\n轻松的日常表达。" },
  detail: {},
  passed: true,
  error: null,
  latency_ms: 850,
  cost: null,
}

// This fixture handles every API request: no request can write to the recording database.
export async function mockAnalysis(page: Page, editor = false) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "visual-fixture-not-a-real-token")
    localStorage.setItem(
      "current_brand_id",
      "11111111-1111-4111-8111-111111111111",
    )
    localStorage.setItem("vite-ui-theme", "light")
  })
  const writes: { path: string; body: Record<string, unknown> }[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push({ path, body })
      if (path.endsWith("/ratings"))
        return route.fulfill({ json: { id: "rating-fixture", ...body } })
      if (path.endsWith("/analyze"))
        return route.fulfill({ json: visualPattern })
      if (path.endsWith("/to-template"))
        return route.fulfill({
          json: {
            id: "scene-fixture",
            name: body.name,
            scene: body.scene,
            template_version: 3,
          },
        })
      if (path.endsWith("/viral-samples"))
        return route.fulfill({
          json: {
            id: ids.sample,
            brand_id: ids.brand,
            text: body.text,
            ...body,
            created_at: date,
          },
        })
      if (path.endsWith("/datasets"))
        return route.fulfill({ json: { ...visualDataset, name: body.name } })
      if (path.endsWith("/runs")) return route.fulfill({ json: visualRun })
      return route.fulfill({
        status: 500,
        json: {
          error: { code: "INTERNAL_ERROR", message: "未配置的测试请求" },
        },
      })
    }
    const paged = (items: unknown[]) => ({
      items,
      total: items.length,
      page: 1,
      page_size: 20,
    })
    let data: unknown
    if (path.endsWith("/users/me"))
      data = {
        id: "fixture-user",
        email: "visual@example.invalid",
        full_name: "视觉走查（演示）",
        is_superuser: !editor,
        is_active: true,
      }
    else if (path.endsWith("/brands"))
      data = {
        items: [
          {
            id: ids.brand,
            name: "香氛品牌（演示）",
            category: "perfume",
            role: editor ? "editor" : "admin",
          },
        ],
      }
    else if (path.endsWith("/models"))
      data = {
        items: [
          { id: "demo-model", model_name: "演示模型", enabled: true },
          { id: "disabled-model", model_name: "未启用模型", enabled: false },
        ],
      }
    else if (path.endsWith("/rubrics"))
      data = {
        rubric_version: "r1",
        scale: { min: 1, max: 3, meaning: "由低到高" },
        dimensions: [
          {
            key: "expression",
            name: "表达清晰度",
            description: "表达是否清楚",
          },
        ],
      }
    else if (path.endsWith("/agreement"))
      data = {
        run_id: ids.run,
        rubric_version: "r1",
        method: "pairwise",
        raters: 1,
        rated_results: 1,
        dimensions: [
          {
            dimension: "expression",
            samples: 1,
            rater_pairs: 0,
            weighted_kappa: null,
            exact_agreement: null,
            within_one: null,
          },
        ],
      }
    else if (path.endsWith("/results")) data = paged([visualResult])
    else if (path.endsWith("/cases"))
      data = paged([
        {
          id: "case-fixture",
          case_index: 0,
          input: { brief: "香氛表达（演示）" },
          expected: { style: "自然克制" },
          annotators: ["演示标注者"],
        },
      ])
    else if (path.endsWith("/evaluation/datasets"))
      data = { items: [visualDataset] }
    else if (path.endsWith("/evaluation/runs")) data = paged([visualRun])
    else if (path.includes("/evaluation/runs/")) data = visualRun
    else if (path.endsWith("/patterns")) data = paged([visualPattern])
    else if (path.includes("/viral-patterns/")) data = visualPattern
    else if (path.endsWith("/viral-samples"))
      data = paged([
        {
          id: ids.sample,
          brand_id: ids.brand,
          excerpt: "日常里的香气片段（演示）",
          char_count: 40,
          note: "用于视觉回归",
          source_url: "https://example.invalid/sample",
          created_at: date,
        },
      ])
    else if (path.includes("/viral-samples/"))
      data = {
        id: ids.sample,
        brand_id: ids.brand,
        text: "日常里的香气片段（演示）\n🌿 留下一点从容的空间。",
        note: "用于视觉回归",
        source_url: "https://example.invalid/sample",
        created_at: date,
      }
    else if (path.includes("knowledge-submissions")) data = paged([])
    else
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "NOT_FOUND", message: "没有找到这个内容" },
          request_id: "fixture-unhandled",
        },
      })
    return route.fulfill({ json: data })
  })
  return writes
}
