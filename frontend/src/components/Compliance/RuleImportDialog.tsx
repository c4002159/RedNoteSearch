import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { ComplianceService, type RuleImportResult } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { type ApiErrorInfo, parseApiError } from "@/lib/apiError"
import { RuleErrors } from "./RuleErrors"

type Mode = "merge" | "replace"
const counts = (result: RuleImportResult, done: boolean) => (
  <dl
    className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    aria-label={done ? "实际导入数量" : "预览数量"}
  >
    {(
      [
        ["created", done ? "已新建" : "将新建"],
        ["updated", done ? "已更新" : "将更新"],
        ["unchanged", "没有变化"],
        ["disabled", done ? "已停用" : "将停用"],
      ] as const
    ).map(([key, title]) => (
      <div className="rounded-lg border bg-card p-3" key={key}>
        <dt className="text-xs text-muted-foreground">{title}</dt>
        <dd className="text-xl font-semibold tabular-nums">{result[key]}</dd>
      </div>
    ))}
  </dl>
)

export function RuleImportDialog({
  brandId,
  onClose,
  onApplied,
  onTemplate,
  templateError,
  templatePending,
}: {
  brandId: string | null
  onClose: () => void
  onApplied: () => void
  onTemplate: (format: "csv" | "json") => void
  templateError?: ApiErrorInfo
  templatePending?: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<Mode>("merge")
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [preview, setPreview] = useState<RuleImportResult | null>(null)
  const [result, setResult] = useState<RuleImportResult | null>(null)
  const [localError, setLocalError] = useState<ApiErrorInfo | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const mutation = useMutation({
    mutationFn: async ({
      selected,
      selectedMode,
      dryRun,
    }: {
      selected: File
      selectedMode: Mode
      dryRun: boolean
    }) => {
      const query = { mode: selectedMode, dry_run: dryRun }
      const options = { body: { file: selected }, query, timeout: 180_000 }
      return (
        brandId
          ? await ComplianceService.importBrandRules({
              ...options,
              path: { brand_id: brandId },
            })
          : await ComplianceService.importGlobalRules(options)
      ).data
    },
    onSuccess: (data, variables) => {
      if (variables.dryRun) {
        setPreview(data)
        setStep(2)
      } else {
        setResult(data)
        setStep(3)
        setConfirmReplace(false)
        onApplied()
      }
    },
    onError: () => {
      setPreview(null)
      setStep(2)
      setConfirmReplace(false)
    },
  })
  const resetPreview = () => {
    setPreview(null)
    setResult(null)
    setAccepted(false)
    setConfirmReplace(false)
    setLocalError(null)
    mutation.reset()
  }
  const runPreview = (selected: File, selectedMode: Mode) => {
    resetPreview()
    setStep(2)
    const message = !/\.(csv|json)$/i.test(selected.name)
      ? "只支持 CSV 或 JSON 文件"
      : selected.size > 1048576
        ? "规则文件不能超过 1 MB"
        : null
    if (message) {
      setLocalError({
        status: 422,
        code: /\.(csv|json)$/i.test(selected.name)
          ? "FILE_TOO_LARGE"
          : "UNSUPPORTED_FILE_TYPE",
        message,
        details: {},
        requestId: null,
      })
      return
    }
    mutation.mutate({ selected, selectedMode, dryRun: true })
  }
  const apply = () => {
    if (file && preview && !mutation.isPending)
      mutation.mutate({ selected: file, selectedMode: mode, dryRun: false })
  }
  const error =
    localError ?? (mutation.isError ? parseApiError(mutation.error) : null)
  const pending = mutation.isPending
  const close = () => {
    if (!pending) onClose()
  }
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
          showCloseButton={!pending}
          onEscapeKeyDown={(e) => pending && e.preventDefault()}
          onInteractOutside={(e) => pending && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>导入风险提示规则</DialogTitle>
            <DialogDescription>
              {brandId
                ? "只针对当前品牌，不包含全局规则。"
                : "只针对全局规则。"}
              全有或全无，有错误时整个文件不会导入。
            </DialogDescription>
          </DialogHeader>
          <ol className="flex flex-wrap gap-3 text-sm" aria-label="导入步骤">
            {["选择文件", "预览", "确认导入"].map((v, i) => (
              <li
                key={v}
                aria-current={step === i + 1 ? "step" : undefined}
                className={
                  step === i + 1
                    ? "font-semibold text-primary"
                    : "text-muted-foreground"
                }
              >
                {i + 1}. {v}
              </li>
            ))}
          </ol>
          {step !== 3 && (
            <fieldset disabled={pending} className="space-y-3">
              <legend className="sr-only">选择规则文件及方式</legend>
              <div className="space-y-1">
                <label htmlFor="rules-file" className="text-sm font-medium">
                  规则文件（CSV / JSON，≤1 MB，1–2000 条）
                </label>
                <Input
                  id="rules-file"
                  type="file"
                  accept=".csv,.json"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] ?? null
                    setFile(selected)
                    if (selected) runPreview(selected, mode)
                    else {
                      resetPreview()
                      setStep(1)
                    }
                  }}
                />
              </div>
              {file && (
                <p className="break-all text-sm text-muted-foreground">
                  已选：{file.name}
                </p>
              )}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="rule-import-mode"
                    value="merge"
                    checked={mode === "merge"}
                    onChange={() => {
                      setMode("merge")
                      if (file) runPreview(file, "merge")
                    }}
                  />
                  合并（保留文件外规则）
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="rule-import-mode"
                    value="replace"
                    checked={mode === "replace"}
                    onChange={() => {
                      setMode("replace")
                      if (file) runPreview(file, "replace")
                    }}
                  />
                  整体替换（停用文件外规则）
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                CSV 支持 UTF-8（可带 BOM）及
                GBK。模板中的“示例，请删除”行须先删除；空文件不能用来整体停用规则。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={templatePending}
                  onClick={() => onTemplate("csv")}
                >
                  下载 CSV 模板
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={templatePending}
                  onClick={() => onTemplate("json")}
                >
                  下载 JSON 模板
                </Button>
              </div>
              {templateError && <RuleErrors error={templateError} />}
            </fieldset>
          )}
          {pending && (
            <p role="status" className="rounded-lg bg-surface p-3 text-sm">
              {mutation.variables?.dryRun
                ? "正在预览…"
                : "正在导入…请等待，窗口暂时无法关闭。"}
            </p>
          )}
          {error && (
            <RuleErrors
              error={error}
              onRetry={
                file && !pending ? () => runPreview(file, mode) : undefined
              }
            />
          )}
          {error?.status === null && mutation.variables?.dryRun === false && (
            <p className="text-sm text-muted-foreground">
              未收到导入结果，暂时无法确定是否已写入。请先导出核对，再重新预览，避免直接重复提交。
            </p>
          )}
          {preview && !error && step === 2 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">预览，还没有写入任何规则</p>
              {counts(preview, false)}
              <p className="text-xs text-muted-foreground">
                确认时会重新计算，实际数量可能变化。空来源不会自动补充，规则不会自动标为示例。
              </p>
            </div>
          )}
          {result && step === 3 && (
            <div className="space-y-3">
              <p role="status" className="font-medium">
                导入完成，已写入审计记录
              </p>
              {counts(result, true)}
              <p className="text-sm text-muted-foreground">
                以上为实际数量。来源为空的规则显示“来源待补充”。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={pending}
            >
              {step === 3 ? "完成" : "取消"}
            </Button>
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setStep(1)
                  setPreview(null)
                  mutation.reset()
                }}
              >
                上一步
              </Button>
            )}
            {step === 1 && file && (
              <Button
                type="button"
                disabled={pending}
                onClick={() => runPreview(file, mode)}
              >
                预览所选文件
              </Button>
            )}
            {step !== 3 && (
              <LoadingButton
                loading={pending}
                disabled={!preview || !!error || step !== 2}
                onClick={() => {
                  if (mode === "replace") {
                    setAccepted(false)
                    setConfirmReplace(true)
                  } else apply()
                }}
              >
                确认导入
              </LoadingButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmReplace}
        onOpenChange={(o) => !pending && setConfirmReplace(o)}
      >
        <DialogContent
          showCloseButton={!pending}
          onEscapeKeyDown={(e) => pending && e.preventDefault()}
          onInteractOutside={(e) => pending && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>确认整体替换</DialogTitle>
            <DialogDescription>
              文件里没有的规则会被停用，不是删除。示例规则同样只会被停用，已有风险提示保持不变。
            </DialogDescription>
          </DialogHeader>
          <p>
            预览将停用 <strong>{preview?.disabled ?? 0}</strong>{" "}
            条规则；提交时会重新计算。
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              disabled={pending}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已了解：将停用 {preview?.disabled ?? 0} 条规则
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmReplace(false)}
            >
              返回预览
            </Button>
            <LoadingButton
              variant="destructive"
              loading={pending}
              disabled={!accepted || !preview}
              onClick={apply}
            >
              确认整体替换并导入
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
