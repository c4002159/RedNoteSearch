import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import { EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"

export const Route = createFileRoute("/_layout/evaluation/")({
  component: EvaluationPage,
  head: () => ({ meta: [{ title: "评测 - RedNoteSearch" }] }),
})

const KIND_LABEL: Record<string, string> = {
  compliance: "风险提示检测",
  factcheck: "事实核查",
  generation: "生成质量",
  brand_leak: "品牌串味",
}
const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  completed: "已完成",
  failed: "失败",
}
const PAGE_SIZE = 20
const kind = (k: string) => KIND_LABEL[k] ?? k

type Metric = {
  name: string
  value: number | null
  definition?: string
  n?: number
}

function EvaluationPage() {
  const brand = useBrand()
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  // 评测只对品牌管理员渲染；直接打开地址显示 403（设计 spec 角色与权限）
  if (!brand.isAdmin) return <ForbiddenPage />
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">评测</h1>
        <p className="text-sm text-muted-foreground">
          评测集版本固定；人工评分只作参考，不是系统验证。
        </p>
      </div>
      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">运行</TabsTrigger>
          <TabsTrigger value="datasets">评测集</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">
          <Runs />
        </TabsContent>
        <TabsContent value="datasets">
          <Datasets />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Datasets() {
  const q = useQuery({
    queryKey: ["eval-datasets"],
    queryFn: async () => (await EvaluationService.readDatasets()).data,
  })
  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (q.isError)
    return <ErrorBanner error={parseApiError(q.error)} onRetry={q.refetch} />
  const items = q.data?.items ?? []
  if (items.length === 0) return <EmptyState title="还没有评测集" />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>范围</TableHead>
          <TableHead>版本</TableHead>
          <TableHead>样本数</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((d) => (
          <TableRow key={d.id}>
            <TableCell>{d.name}</TableCell>
            <TableCell>{kind(d.kind)}</TableCell>
            <TableCell>{d.brand_id ? "品牌" : "全局"}</TableCell>
            <TableCell>v{d.version}</TableCell>
            <TableCell>{d.case_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Runs() {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ["eval-runs", page],
    queryFn: async () =>
      (
        await EvaluationService.readRuns({
          query: { page, page_size: PAGE_SIZE },
        })
      ).data,
  })
  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (q.isError)
    return <ErrorBanner error={parseApiError(q.error)} onRetry={q.refetch} />
  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0
  if (items.length === 0) return <EmptyState title="还没有评测运行" />
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>类型</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>样本数</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{kind(r.kind)}</TableCell>
              <TableCell>
                <Pill>{RUN_STATUS_LABEL[r.status] ?? r.status}</Pill>
              </TableCell>
              <TableCell>{r.sample_count}</TableCell>
              <TableCell>{r.versions.models.join("、") || "—"}</TableCell>
              <TableCell>
                {r.created_at?.slice(0, 16).replace("T", " ") ?? "—"}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => setOpen(r.id)}>
                  查看指标
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
      {open && <RunDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["eval-run", id],
    queryFn: async () =>
      (await EvaluationService.readRun({ path: { run_id: id } })).data,
    // 异步运行：排队中、运行中定期重新读取（间隔为设计假设，契约未规定）
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "")
        ? 3000
        : false,
  })
  const run = q.data
  const waiting = run && ["queued", "running"].includes(run.status)
  const metrics = (run?.metrics ?? {}) as Record<string, Metric[]>
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>运行指标</DialogTitle>
          <DialogDescription>
            指标没有综合分；价格未配置时费用显示“—”。
          </DialogDescription>
        </DialogHeader>
        {q.isLoading && <Skeleton className="h-32 w-full" />}
        {q.isError && (
          <ErrorBanner error={parseApiError(q.error)} onRetry={q.refetch} />
        )}
        {run?.error && (
          <p className="text-sm text-destructive">错误：{run.error}</p>
        )}
        {waiting && (
          <p className="text-sm">
            {RUN_STATUS_LABEL[run.status]}，完成后显示指标…
          </p>
        )}
        {run && !waiting && Object.keys(metrics).length === 0 && !run.error && (
          <EmptyState title="没有指标" />
        )}
        {Object.entries(metrics).map(([system, list]) => (
          <div key={system} className="space-y-1">
            <h3 className="text-sm font-medium">{system}</h3>
            <Table>
              <TableBody>
                {list.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className="font-mono text-xs">
                      {m.name}
                    </TableCell>
                    <TableCell>{m.value ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.definition ?? ""}
                      {m.n != null ? `（n=${m.n}）` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
        {run && run.failures.length > 0 && (
          <p className="text-sm text-muted-foreground">
            失败样本 {run.failures.length} 条
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
