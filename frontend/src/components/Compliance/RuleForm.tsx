import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import {
  ComplianceService,
  type RuleCreate,
  type RulePublic,
  type RuleUpdate,
} from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
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
import { Textarea } from "@/components/ui/textarea"
import { parseApiError } from "@/lib/apiError"
import { SEVERITY_LABEL } from "@/lib/zh"
import { RuleErrors } from "./RuleErrors"
import { EDITABLE_LAYER_LABEL, RULE_TYPE_LABEL, selectClass } from "./rules"

const limited = (max: number) =>
  z.string().refine((v) => [...v].length <= max, `不能超过 ${max} 字`)
const base = z.object({
  pattern: limited(200).refine((v) => !!v.trim(), "请填写规则内容"),
  layer: z.enum(["lexicon", "efficacy_basis"]),
  rule_type: z.enum([
    "absolute_term",
    "efficacy_claim",
    "medical_term",
    "data_claim",
    "platform_rule",
    "brand_forbidden",
  ]),
  severity: z.enum(["block", "warn"]),
  is_regex: z.boolean(),
  suggestion: limited(500),
  source_name: limited(200),
  source_clause: limited(300),
  source_url: limited(500),
  region_scope: limited(50),
  effective_from: z.string(),
  effective_to: z.string(),
})
type Values = z.infer<typeof base>

export function RuleForm({
  row,
  brandId,
  onClose,
  onSaved,
}: {
  row?: RulePublic
  brandId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const schema = base.superRefine((v, ctx) => {
    if (!v.source_name.trim() && row?.source_name !== "")
      ctx.addIssue({
        code: "custom",
        path: ["source_name"],
        message: "请填写来源名称",
      })
    if (v.effective_from && v.effective_to && v.effective_from > v.effective_to)
      ctx.addIssue({
        code: "custom",
        path: ["effective_to"],
        message: "失效日期不得早于生效日期",
      })
  })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      pattern: row?.pattern ?? "",
      layer: row?.layer === "efficacy_basis" ? "efficacy_basis" : "lexicon",
      rule_type: (row?.rule_type ?? "absolute_term") as Values["rule_type"],
      severity: (row?.severity ?? "warn") as Values["severity"],
      is_regex: row?.is_regex ?? false,
      suggestion: row?.suggestion ?? "",
      source_name: row?.source_name ?? "",
      source_url: row?.source_url ?? "",
      source_clause: row?.source_clause ?? "",
      region_scope: row?.region_scope ?? "",
      effective_from: row?.effective_from ?? "",
      effective_to: row?.effective_to ?? "",
    },
  })
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      const body: RuleCreate = {
        ...values,
        pattern: values.pattern.trim(),
        effective_from: values.effective_from || null,
        effective_to: values.effective_to || null,
        source_url: values.source_url || null,
        source_clause: values.source_clause || null,
        region_scope: values.region_scope || null,
      }
      if (row) {
        const changes: RuleUpdate = {}
        for (const key of Object.keys(
          form.formState.dirtyFields,
        ) as (keyof Values)[])
          Object.assign(changes, { [key]: body[key] })
        // Stored empty sources may be left unchanged; do not send the display placeholder or an empty update.
        if (row.source_name === "" && values.source_name === "")
          delete changes.source_name
        return (
          await ComplianceService.updateRule({
            path: { rule_id: row.id },
            body: changes,
          })
        ).data
      }
      return brandId
        ? (
            await ComplianceService.createBrandRule({
              path: { brand_id: brandId },
              body,
            })
          ).data
        : (await ComplianceService.createGlobalRule({ body })).data
    },
    onSuccess: onSaved,
    onError: (err) => {
      const info = parseApiError(err)
      const errors = info.details.errors
      if (!Array.isArray(errors) && info.code === "VALIDATION_ERROR") {
        if (/正则|规则内容/.test(info.message))
          form.setError("pattern", { message: info.message })
        else if (/日期/.test(info.message))
          form.setError("effective_to", { message: info.message })
      }
      if (Array.isArray(errors))
        for (const e of errors) {
          const key = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null
          if (key && key in form.getValues())
            form.setError(key as keyof Values, { message: String(e.msg) })
        }
    },
  })
  const textFields: {
    key: keyof Pick<
      Values,
      | "pattern"
      | "suggestion"
      | "source_name"
      | "source_url"
      | "source_clause"
      | "region_scope"
    >
    title: string
    max: number
    area?: boolean
  }[] = [
    { key: "pattern", title: "规则内容（必填）", max: 200, area: true },
    { key: "suggestion", title: "修改建议", max: 500, area: true },
    {
      key: "source_name",
      title:
        row?.source_name === ""
          ? "来源名称（可保持原空值）"
          : "来源名称（必填）",
      max: 200,
    },
    { key: "source_clause", title: "出处条款", max: 300 },
    { key: "source_url", title: "来源链接（只保存文本）", max: 500 },
    { key: "region_scope", title: "适用地区", max: 50 },
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !mutation.isPending && onClose()}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{row ? "编辑规则" : "新建规则"}</DialogTitle>
          <DialogDescription>
            {brandId ? "只维护当前品牌规则。" : "维护全局规则。"}
            规则用于风险提示，供人工复核。
          </DialogDescription>
        </DialogHeader>
        {row?.is_sample && (
          <p className="rounded-lg bg-tone-warn-bg p-3 text-sm text-tone-warn">
            示例规则来源待核对，不是正式依据。保存修改后不再标为示例，但不表示来源已核对。
          </p>
        )}
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="space-y-4"
        >
          <fieldset
            disabled={mutation.isPending}
            className="grid min-w-0 gap-3 sm:grid-cols-2"
          >
            <legend className="sr-only">规则字段</legend>
            {(
              [
                ["layer", "层级", EDITABLE_LAYER_LABEL],
                ["rule_type", "类型", RULE_TYPE_LABEL],
                ["severity", "严重度", SEVERITY_LABEL],
              ] as const
            ).map(([key, title, options]) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`rule-${key}`} className="text-sm font-medium">
                  {title}
                </label>
                <select
                  id={`rule-${key}`}
                  className={selectClass}
                  {...form.register(key)}
                >
                  {Object.entries(options).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                id="rule-regex"
                type="checkbox"
                {...form.register("is_regex")}
              />
              <label htmlFor="rule-regex" className="text-sm">
                规则内容为正则表达式
              </label>
            </div>
            {textFields.map(({ key, title, max, area }) => (
              <div
                key={key}
                className={area ? "space-y-1 sm:col-span-2" : "space-y-1"}
              >
                <label htmlFor={`rule-${key}`} className="text-sm font-medium">
                  {title}
                </label>
                {area ? (
                  <Textarea
                    id={`rule-${key}`}
                    {...form.register(key)}
                    aria-invalid={!!form.formState.errors[key]}
                  />
                ) : (
                  <Input
                    id={`rule-${key}`}
                    {...form.register(key)}
                    aria-invalid={!!form.formState.errors[key]}
                  />
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-destructive">
                    {form.formState.errors[key]?.message}
                  </span>
                  <CharCounter
                    value={[...form.watch(key)].length}
                    limit={max}
                  />
                </div>
              </div>
            ))}
            {(
              [
                ["effective_from", "生效日期"],
                ["effective_to", "失效日期"],
              ] as const
            ).map(([key, title]) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`rule-${key}`} className="text-sm font-medium">
                  {title}
                </label>
                <Input
                  id={`rule-${key}`}
                  type="date"
                  {...form.register(key)}
                  aria-invalid={!!form.formState.errors[key]}
                />
                <p className="text-xs text-destructive">
                  {form.formState.errors[key]?.message}
                </p>
              </div>
            ))}
          </fieldset>
          {mutation.isError && (
            <RuleErrors error={parseApiError(mutation.error)} />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              取消
            </Button>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              disabled={!!row && !form.formState.isDirty}
            >
              保存规则
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
