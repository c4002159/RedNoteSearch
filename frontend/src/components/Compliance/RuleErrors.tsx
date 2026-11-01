import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import type { ApiErrorInfo } from "@/lib/apiError"
import { LAYER_LABEL, label, PAGE_ERROR_TEXT, RULE_ERROR_TEXT } from "@/lib/zh"
import { RULE_TYPE_LABEL } from "./rules"

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> =>
          v !== null && typeof v === "object",
      )
    : []
const text = (value: unknown) =>
  value === null || value === undefined ? "—" : String(value)

export function RuleErrors({
  error,
  onRetry,
}: {
  error: ApiErrorInfo
  onRetry?: () => void
}) {
  const conflicts = records(error.details.conflicts)
  const errors = records(error.details.errors)
  return (
    <div className="min-w-0 space-y-3">
      <ErrorBanner
        error={{
          ...error,
          message: /[\u3400-\u9fff]/.test(error.message)
            ? error.message
            : (PAGE_ERROR_TEXT.status[error.status ?? 0] ??
              PAGE_ERROR_TEXT.failed),
        }}
        onRetry={onRetry}
      />
      {error.status === 403 && <ForbiddenPage requestId={error.requestId} />}
      {errors.length > 0 && (
        <section
          className="rounded-lg border p-3 text-sm"
          aria-label="逐行错误"
        >
          <div className="grid grid-cols-3 gap-2 font-medium">
            <span>文件行号</span>
            <span>列</span>
            <span>原因</span>
          </div>
          {errors.map((e, i) => (
            <div
              key={i}
              className="grid grid-cols-3 gap-2 border-t py-2 [overflow-wrap:anywhere]"
            >
              <span>{text(e.row)}</span>
              <span>
                {RULE_ERROR_TEXT.fields[
                  text(
                    e.column ??
                      (Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null),
                  )
                ] ?? RULE_ERROR_TEXT.otherField}
              </span>
              <span>
                {/[\u3400-\u9fff]/.test(text(e.msg))
                  ? text(e.msg)
                  : RULE_ERROR_TEXT.invalidValue}
              </span>
            </div>
          ))}
        </section>
      )}
      {conflicts.length > 0 && (
        <section
          className="space-y-3 rounded-lg border p-3 text-sm"
          aria-label="重复键冲突"
        >
          <p className="font-medium">请在文件里填入目标规则 id 后重新预览</p>
          {conflicts.map((c, i) => (
            <dl
              key={i}
              className="space-y-1 border-t pt-2 [overflow-wrap:anywhere]"
            >
              <div>
                <dt className="inline">层级 / 类型：</dt>
                <dd className="inline">
                  {label(LAYER_LABEL, text(c.layer))} /{" "}
                  {label(RULE_TYPE_LABEL, text(c.rule_type))}
                </dd>
              </div>
              <div>
                <dt className="inline">规则内容：</dt>
                <dd className="inline whitespace-pre-wrap">
                  {text(c.pattern)}
                </dd>
              </div>
              <div>
                <dt className="inline">{RULE_ERROR_TEXT.rows}</dt>
                <dd className="inline">
                  {Array.isArray(c.rows) ? c.rows.map(text).join("、") : "—"}
                </dd>
              </div>
              <div>
                <dt>{RULE_ERROR_TEXT.ids}</dt>
                <dd>
                  {Array.isArray(c.rule_ids)
                    ? c.rule_ids.map((id, j) => (
                        <code className="block" key={j}>
                          {text(id)}
                        </code>
                      ))
                    : "—"}
                </dd>
              </div>
            </dl>
          ))}
        </section>
      )}
    </div>
  )
}
