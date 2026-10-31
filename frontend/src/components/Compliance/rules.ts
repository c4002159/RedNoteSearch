import { AxiosError } from "axios"
import type { RuleType } from "@/client"

export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  absolute_term: "绝对化用语",
  efficacy_claim: "功效宣称",
  medical_term: "医疗用语",
  data_claim: "数据宣称",
  platform_rule: "平台规则",
  brand_forbidden: "品牌禁用词",
}
export const EDITABLE_LAYER_LABEL = {
  lexicon: "词表",
  efficacy_basis: "功效依据",
} as const
export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
export const sourceText = (row: { is_sample: boolean; source_name: string }) =>
  row.is_sample ? "来源待核对，不是正式依据" : row.source_name || "来源待补充"

// Downloads use blobs; restore the JSON error envelope before the shared Query error handlers see it.
export async function downloadError(error: unknown): Promise<never> {
  if (error instanceof AxiosError && error.response?.data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await error.response.data.text())
    } catch {
      /* shared fallback */
    }
  }
  throw error
}

export function saveDownload(
  data: unknown,
  disposition: unknown,
  fallbackName: string,
) {
  let filename =
    typeof disposition === "string"
      ? /filename="?([^";]+)"?/.exec(disposition)?.[1]
      : null
  if (typeof disposition === "string") {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
    if (encoded) {
      try {
        filename = decodeURIComponent(encoded)
      } catch {
        /* use basic filename */
      }
    }
  }
  if (!(data instanceof Blob)) throw new Error("下载响应缺少文件信息")
  const url = URL.createObjectURL(data)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = (filename || fallbackName).replace(/[/\\]/g, "_")
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
