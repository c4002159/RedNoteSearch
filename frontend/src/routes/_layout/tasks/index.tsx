import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"

import { type FlowStatus, TasksService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import { FLOW_STATUS_LABEL } from "@/lib/zh"

export const Route = createFileRoute("/_layout/tasks/")({
  component: TasksPage,
  head: () => ({ meta: [{ title: "任务与版本历史 - RedNoteSearch" }] }),
})

const PAGE_SIZE = 20
const RUNNING = ["generating", "checking"]

function TasksPage() {
  const { current } = useBrand()
  const brandId = current?.id ?? ""
  const [status, setStatus] = useState<FlowStatus | "">("")
  const [sort, setSort] = useState("-created_at")
  const [page, setPage] = useState(1)

  const tasks = useQuery({
    queryKey: ["tasks", brandId, status, sort, page],
    queryFn: async () =>
      (
        await TasksService.readTasks({
          query: {
            brand_id: brandId,
            status: status || undefined,
            sort,
            page,
            page_size: PAGE_SIZE,
          },
        })
      ).data,
    enabled: !!brandId,
    refetchInterval: (q) =>
      q.state.data?.items.some((t) => RUNNING.includes(t.flow_status))
        ? 3_000
        : false,
  })

  const totalPages = Math.max(
    1,
    Math.ceil((tasks.data?.total ?? 0) / PAGE_SIZE),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">任务与版本历史</h1>
          <p className="text-sm text-muted-foreground">
            当前品牌的全部生成任务。点开任务可查看每个版本、对比两个版本。
          </p>
        </div>
        <Button asChild>
          <Link to="/generate" search={{ task: undefined }}>
            新建任务
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          aria-label="按状态筛选"
          className="h-10 rounded-lg border border-transparent bg-surface-low px-3 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as FlowStatus | "")
            setPage(1)
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(FLOW_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="排序"
          className="h-10 rounded-lg border border-transparent bg-surface-low px-3 text-sm"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value)
            setPage(1)
          }}
        >
          <option value="-created_at">最新创建在前</option>
          <option value="created_at">最早创建在前</option>
        </select>
      </div>

      {!current && (
        <EmptyState title="请先选择品牌" description="在顶栏选择一个品牌。" />
      )}
      {tasks.isLoading && <Skeleton className="h-48 w-full" />}
      {tasks.isError && (
        <ErrorBanner
          error={parseApiError(tasks.error)}
          onRetry={() => tasks.refetch()}
        />
      )}
      {tasks.data && tasks.data.items.length === 0 && (
        <EmptyState
          title={status ? "没有符合条件的任务" : "还没有任务"}
          description={
            status ? "换一个状态再看看。" : "到生成工作台创建第一个任务。"
          }
        />
      )}
      {tasks.data && tasks.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品</TableHead>
                <TableHead>场景</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.data.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.product_name ?? "—"}
                  </TableCell>
                  <TableCell>{t.scenario_name ?? "—"}</TableCell>
                  <TableCell>
                    <FlowStatusBadge status={t.flow_status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTime(t.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/tasks/$taskId" params={{ taskId: t.id }}>
                        查看
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tasks.data && tasks.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span className="text-muted-foreground">
            第 {page} / {totalPages} 页，共 {tasks.data.total} 个
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
