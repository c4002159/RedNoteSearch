import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ChevronDown, MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ComplianceService,
  type Layer,
  type RulePublic,
  type RuleType,
  type Severity,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { FilterSelect } from "@/components/Common/FilterSelect"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { LoadingState } from "@/components/Common/LoadingState"
import { ReasonDialog } from "@/components/Common/ReasonDialog"
import { SearchBox } from "@/components/Common/SearchBox"
import { SimplePager } from "@/components/Common/SimplePager"
import { Pill, SeverityBadge } from "@/components/Common/StatusBadge"
import {
  TableBatchBar,
  TableSelectAll,
  TableSelectRow,
} from "@/components/Common/TableBatchBar"
import { TableName } from "@/components/Common/TableName"
import { RuleBatchDialog } from "@/components/Compliance/RuleBatchDialog"
import { RuleErrors } from "@/components/Compliance/RuleErrors"
import { RuleForm } from "@/components/Compliance/RuleForm"
import { RuleImportDialog } from "@/components/Compliance/RuleImportDialog"
import {
  downloadError,
  RULE_TYPE_LABEL,
  saveDownload,
  sourceText,
} from "@/components/Compliance/rules"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import {
  TABLE_TEXT as B,
  LAYER_LABEL,
  label,
  R6_RULE_TEXT as R,
  SEVERITY_LABEL,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/compliance/rules")({
  component: RulesPage,
  head: () => ({ meta: [{ title: "风险提示规则 - RedNoteSearch" }] }),
})
const PAGE_SIZE = 20

function RuleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["compliance-rule", id],
    queryFn: async () =>
      (await ComplianceService.readRule({ path: { rule_id: id } })).data,
    retry: (attempt, error) =>
      ![401, 403, 404].includes(parseApiError(error).status ?? 0) &&
      attempt < 2,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>规则详情</DialogTitle>
          <DialogDescription>
            当前规则信息；历史风险提示保留命中时的规则快照。
          </DialogDescription>
        </DialogHeader>
        {query.isLoading && <LoadingState className="h-32 w-full" />}
        {query.isError &&
          (parseApiError(query.error).status === 404 ? (
            <MissingPage requestId={parseApiError(query.error).requestId} />
          ) : (
            <RuleErrors
              error={parseApiError(query.error)}
              onRetry={() => query.refetch()}
            />
          ))}
        {query.data && (
          <dl className="space-y-3 text-sm [overflow-wrap:anywhere]">
            {(
              [
                ["规则 id", query.data.id],
                ["范围", query.data.brand_id ? "品牌规则" : "全局规则"],
                ["规则内容", query.data.pattern],
                ["层级", label(LAYER_LABEL, query.data.layer)],
                ["类型", label(RULE_TYPE_LABEL, query.data.rule_type)],
                ["严重度", label(SEVERITY_LABEL, query.data.severity)],
                ["匹配方式", query.data.is_regex ? "正则表达式" : "普通文字"],
                ["修改建议", query.data.suggestion || ""],
                ["来源", sourceText(query.data)],
                ["出处条款", query.data.source_clause || ""],
                ["来源链接（纯文本）", query.data.source_url || ""],
                ["适用地区", query.data.region_scope || ""],
                ["生效日期", query.data.effective_from || ""],
                ["失效日期", query.data.effective_to || ""],
                ["版本", `v${query.data.rule_version}`],
                ["状态", query.data.enabled ? "启用" : "已停用"],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RulesPage() {
  const brand = useBrand()
  const { user } = useAuth()
  if (brand.isLoading || !user) return <LoadingState className="h-48 w-full" />
  if (brand.isError)
    return (
      <ErrorBanner
        error={{
          status: null,
          code: "UNKNOWN",
          message: "品牌列表加载失败，请重试",
          details: {},
          requestId: null,
        }}
        onRetry={brand.refetch}
      />
    )
  return (
    <ScopedRules
      key={brand.current?.id ?? "global"}
      brandId={brand.current?.id ?? null}
      isAdmin={brand.isAdmin}
      anyBrandAdmin={brand.brands.some((b) => b.role === "admin")}
      isPlatform={!!user.is_superuser}
    />
  )
}

function ScopedRules({
  brandId,
  isAdmin,
  anyBrandAdmin,
  isPlatform,
}: {
  brandId: string | null
  isAdmin: boolean
  anyBrandAdmin: boolean
  isPlatform: boolean
}) {
  const client = useQueryClient()
  const [scope, setScope] = useState<"global" | "brand">(
    brandId ? "brand" : "global",
  )
  const [layer, setLayer] = useState<Layer | "">("")
  const [type, setType] = useState<RuleType | "">("")
  const [severity, setSeverity] = useState<Severity | "">("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<{
    ids: string[]
    enabled: boolean
  } | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const known = useRef(new Map<string, RulePublic>())
  const [editing, setEditing] = useState<RulePublic | "new" | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [reasonTarget, setReasonTarget] = useState<RulePublic | null>(null)
  const [importing, setImporting] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const target = scope === "brand" ? brandId : null
  const canEdit = scope === "global" ? isPlatform : !!brandId && isAdmin
  const canTemplate = isPlatform || anyBrandAdmin
  const createScopes = [
    ...(brandId && isAdmin ? (["brand"] as const) : []),
    ...(isPlatform ? (["global"] as const) : []),
  ]
  const activeFilters = [q, layer, type, severity].filter(Boolean).length
  const rules = useQuery({
    queryKey: [
      "compliance-rules",
      brandId,
      scope,
      layer,
      type,
      severity,
      q,
      page,
      showDeleted,
    ],
    queryFn: async ({ signal }) =>
      (
        await ComplianceService.readRules({
          query: {
            scope,
            include_inactive: showDeleted,
            brand_id: scope === "brand" ? (brandId ?? undefined) : undefined,
            layer: layer || undefined,
            rule_type: type || undefined,
            severity: severity || undefined,
            q: q || undefined,
            page,
            page_size: PAGE_SIZE,
          },
          signal,
        })
      ).data,
    enabled: scope === "global" || !!brandId,
    retry: (attempt, error) =>
      ![401, 403, 422].includes(parseApiError(error).status ?? 0) &&
      attempt < 2,
  })
  const pages = Math.max(1, Math.ceil((rules.data?.total ?? 0) / PAGE_SIZE))
  const shown = rules.data?.items ?? []
  useEffect(() => {
    if (rules.data && page > pages) setPage(pages)
  }, [rules.data, page, pages])
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["compliance-rules"] })
    await client.invalidateQueries({ queryKey: ["compliance-rule"] })
  }
  const saved = () => {
    setEditing(null)
    toast.success("规则已保存")
    void refresh()
  }
  const toggle = useMutation({
    mutationFn: async ({ row, reason }: { row: RulePublic; reason: string }) =>
      (
        await ComplianceService.updateRule({
          path: { rule_id: row.id },
          body: { enabled: !row.enabled, reason },
        })
      ).data,
    onSuccess: () => {
      setReasonTarget(null)
      toast.success("规则状态已更新")
      void refresh()
    },
    onError: () => setReasonTarget(null),
  })
  const download = useMutation({
    mutationFn: async ({
      format,
      template,
    }: {
      format: "csv" | "json"
      template: boolean
    }) => {
      try {
        const options = { query: { format }, responseType: "blob" as const }
        const result = template
          ? await ComplianceService.downloadRuleTemplate(options)
          : target
            ? await ComplianceService.exportBrandRules({
                ...options,
                path: { brand_id: target },
              })
            : await ComplianceService.exportGlobalRules(options)
        saveDownload(
          result.data,
          result.headers["content-disposition"],
          `${template ? "rules-template" : target ? "brand-rules" : "global-rules"}.${format}`,
        )
      } catch (e) {
        return downloadError(e)
      }
    },
    onSuccess: () => toast.success("下载已开始"),
  })
  for (const row of shown) known.current.set(row.id, row)
  const selection = {
    selected,
    onChange: setSelected,
    pageIds: shown
      .filter((row) => row.layer !== "context")
      .map((row) => row.id),
  }
  const selectedRows = [...selected]
    .map((id) => known.current.get(id))
    .filter((row): row is RulePublic => !!row)
  const toDelete = selectedRows.filter((row) => row.enabled).map((r) => r.id)
  const toRestore = selectedRows.filter((row) => !row.enabled).map((r) => r.id)
  const names = Object.fromEntries(
    [...known.current.values()].map((row) => [row.id, row.pattern]),
  )
  const loadAll = async () => {
    const ids: string[] = []
    for (let nextPage = 1; ; nextPage++) {
      const result = (
        await ComplianceService.readRules({
          query: {
            scope,
            include_inactive: showDeleted,
            brand_id: scope === "brand" ? brandId : undefined,
            layer: layer || undefined,
            rule_type: type || undefined,
            severity: severity || undefined,
            q: q || undefined,
            page: nextPage,
            page_size: 100,
          },
        })
      ).data
      for (const row of result.items) known.current.set(row.id, row)
      ids.push(
        ...result.items
          .filter((row) => row.layer !== "context")
          .map((row) => row.id),
      )
      if (
        ids.length >= 50 ||
        nextPage * 100 >= result.total ||
        !result.items.length
      )
        return ids.slice(0, 50)
    }
  }
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">风险提示规则</h1>
          <p className="text-sm text-muted-foreground">
            命中后给出风险提示，供人工复核；不是法律依据，不代表文字合规。
          </p>
        </div>
        {(createScopes.length > 0 || canTemplate || canEdit) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="更多操作"
                disabled={download.isPending}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {createScopes.length > 0 && (
                <DropdownMenuItem onClick={() => setEditing("new")}>
                  新建规则
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem
                  onClick={() => {
                    download.reset()
                    setImporting(true)
                  }}
                >
                  导入规则
                </DropdownMenuItem>
              )}
              {canTemplate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>下载模板</DropdownMenuLabel>
                  {(["csv", "json"] as const).map((format) => (
                    <DropdownMenuItem
                      key={`t-${format}`}
                      onClick={() =>
                        download.mutate({ format, template: true })
                      }
                    >
                      模板 {format.toUpperCase()}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>导出规则</DropdownMenuLabel>
                  {(["csv", "json"] as const).map((format) => (
                    <DropdownMenuItem
                      key={`e-${format}`}
                      onClick={() =>
                        download.mutate({ format, template: false })
                      }
                    >
                      导出为 {format.toUpperCase()}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {scope === "brand"
          ? "当前品牌规则；导入和导出不包含全局规则。"
          : "全局规则；只有平台管理员可以维护。"}
        {!canEdit && " 当前范围只读。"}列表包含已停用规则。
      </p>
      <div className="min-w-0 overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="border-b border-border/40">
          <button
            type="button"
            aria-expanded={filtersOpen}
            className="flex w-full items-center gap-2 px-6 py-3 text-sm font-semibold"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            筛选
            {activeFilters > 0 && (
              <span className="rounded-full bg-accent px-2 text-xs text-link">
                {activeFilters}
              </span>
            )}
            <ChevronDown
              className={`ml-auto size-4 text-muted-foreground transition-transform ${filtersOpen ? "rotate-180" : ""}`}
            />
          </button>
          {filtersOpen && (
            <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
              <SearchBox
                value={q}
                placeholder="搜索规则内容、建议或来源"
                onChange={(v) => {
                  setQ(v)
                  setPage(1)
                }}
              />
              <FilterSelect
                title="规则范围"
                value={scope}
                onChange={(v) => {
                  setSelected(new Set())
                  setScope(v as "global" | "brand")
                  setPage(1)
                  toggle.reset()
                  download.reset()
                }}
                options={[
                  { value: "global", label: "全局规则" },
                  ...(brandId ? [{ value: "brand", label: "品牌规则" }] : []),
                ]}
              />
              {(
                [
                  [
                    "层级",
                    layer,
                    LAYER_LABEL,
                    (v: string) => setLayer(v as Layer | ""),
                  ],
                  [
                    "类型",
                    type,
                    RULE_TYPE_LABEL,
                    (v: string) => setType(v as RuleType | ""),
                  ],
                  [
                    "严重度",
                    severity,
                    SEVERITY_LABEL,
                    (v: string) => setSeverity(v as Severity | ""),
                  ],
                ] as const
              ).map(([title, value, options, setValue]) => (
                <FilterSelect
                  key={title}
                  title={title}
                  value={value}
                  onChange={(v) => {
                    setValue(v)
                    setPage(1)
                  }}
                  options={[
                    { value: "", label: "全部" },
                    ...Object.entries(options).map(([k, v]) => ({
                      value: k,
                      label: v,
                    })),
                  ]}
                />
              ))}
              <Button
                variant="ghost"
                onClick={() => {
                  setQ("")
                  setLayer("")
                  setType("")
                  setSeverity("")
                  setPage(1)
                }}
              >
                清除
              </Button>
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Checkbox
              id="show-deleted-rules"
              checked={showDeleted}
              onCheckedChange={(checked) => {
                setShowDeleted(checked === true)
                setSelected(new Set())
                setPage(1)
              }}
            />
            <label htmlFor="show-deleted-rules" className="text-sm">
              {R.showDeleted}
            </label>
          </div>
        )}
        {download.isError && !importing && (
          <RuleErrors error={parseApiError(download.error)} />
        )}
        {toggle.isError && <RuleErrors error={parseApiError(toggle.error)} />}
        {rules.isLoading && <LoadingState className="h-64 w-full" />}
        {rules.isError && (
          <RuleErrors
            error={parseApiError(rules.error)}
            onRetry={() => rules.refetch()}
          />
        )}
        {!rules.isLoading && !rules.isError && shown.length === 0 && (
          <EmptyState
            title={
              layer || type || severity
                ? "没有符合条件的规则"
                : "当前范围还没有规则"
            }
            description={
              layer || type || severity
                ? "调整或清除筛选后再试。"
                : canEdit
                  ? "可以新建规则，或下载模板后批量导入。"
                  : "请联系管理员维护规则。"
            }
          />
        )}
        {!rules.isError && shown.length > 0 && (
          <div className="min-w-0 overflow-hidden">
            {canEdit && (
              <div className="p-3">
                <TableBatchBar
                  key={scope}
                  {...selection}
                  total={rules.data?.total ?? 0}
                  loadAll={loadAll}
                  actions={[
                    {
                      label: R.batchDelete,
                      destructive: true,
                      disabled: !toDelete.length,
                      onSelect: () =>
                        setBatch({ ids: toDelete, enabled: false }),
                    },
                    {
                      label: R.batchRestore,
                      disabled: !toRestore.length,
                      onSelect: () =>
                        setBatch({ ids: toRestore, enabled: true }),
                    },
                  ]}
                />
              </div>
            )}
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-12">
                      <TableSelectAll {...selection} />
                    </TableHead>
                  )}
                  <TableHead className="w-1/3">规则内容</TableHead>
                  <TableHead>{R.source}</TableHead>
                  <TableHead>严重度</TableHead>
                  <TableHead>版本 / 状态</TableHead>
                  <TableHead className="w-1/4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.id}>
                    {canEdit && (
                      <TableCell>
                        <TableSelectRow
                          {...selection}
                          id={row.id}
                          label={row.pattern}
                          disabled={row.layer === "context"}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      <button
                        type="button"
                        className="text-left font-medium text-link hover:underline"
                        onClick={() => setDetail(row.id)}
                      >
                        {row.pattern}
                      </button>
                      {row.is_regex && <Pill className="ml-2">正则</Pill>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {label(RULE_TYPE_LABEL, row.rule_type)} ·{" "}
                        {label(LAYER_LABEL, row.layer)}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="max-w-full cursor-help truncate text-left text-sm text-muted-foreground"
                          >
                            {row.is_sample && (
                              <Pill tone="warn" className="mr-1">
                                示例
                              </Pill>
                            )}
                            {row.is_sample
                              ? R.sourceSample
                              : row.source_name || R.sourceMissing}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          <p>{sourceText(row)}</p>
                          {row.source_clause && <p>{row.source_clause}</p>}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={row.severity} />
                    </TableCell>
                    <TableCell>
                      <span className="block text-sm text-muted-foreground tabular-nums">
                        v{row.rule_version}
                      </span>
                      <Pill tone={row.enabled ? "ok" : "gray"}>
                        {row.enabled ? R.active : R.deleted}
                      </Pill>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {canEdit && row.layer !== "context" ? (
                          <>
                            <TableName editable onClick={() => setEditing(row)}>
                              {B.edit}
                            </TableName>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                toggle.reset()
                                setReasonTarget(row)
                              }}
                              className={
                                row.enabled ? "text-tone-err" : "text-link"
                              }
                            >
                              {row.enabled ? R.delete : R.restore}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            只读
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {rules.data && !rules.isError && (
        <SimplePager page={page} total={rules.data.total} onPage={setPage} />
      )}
      {batch && canEdit && (
        <RuleBatchDialog
          key={`${batch.enabled}`}
          ids={batch.ids}
          enabled={batch.enabled}
          brandId={target}
          names={names}
          onClose={() => setBatch(null)}
          onApplied={(ids) => {
            setSelected(
              (previous) =>
                new Set([...previous].filter((id) => !ids.includes(id))),
            )
            void refresh()
          }}
        />
      )}

      {editing && canEdit && (
        <RuleForm
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? undefined : editing}
          brandId={brandId}
          scopes={createScopes}
          defaultScope={scope}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {detail && <RuleDetail id={detail} onClose={() => setDetail(null)} />}
      {reasonTarget && canEdit && (
        <ReasonDialog
          key={reasonTarget.id}
          open
          title={reasonTarget.enabled ? R.deleteTitle : R.restoreTitle}
          description={`${reasonTarget.pattern} · ${label(RULE_TYPE_LABEL, reasonTarget.rule_type)} · ${label(LAYER_LABEL, reasonTarget.layer)} · v${reasonTarget.rule_version}。${reasonTarget.enabled ? R.deleteDescription : "恢复后新检查会再次使用该规则。原因只写入审计。"}`}
          confirmLabel={reasonTarget.enabled ? "确认删除" : "确认恢复"}
          variant={reasonTarget.enabled ? "destructive" : "default"}
          pending={toggle.isPending}
          onCancel={() => setReasonTarget(null)}
          onConfirm={(reason) => toggle.mutate({ row: reasonTarget, reason })}
        />
      )}
      {importing && canEdit && (
        <RuleImportDialog
          brandId={target}
          onClose={() => setImporting(false)}
          onApplied={() => void refresh()}
          onTemplate={(format) => download.mutate({ format, template: true })}
          templateError={
            download.isError ? parseApiError(download.error) : undefined
          }
          templatePending={download.isPending}
        />
      )}
    </div>
  )
}
