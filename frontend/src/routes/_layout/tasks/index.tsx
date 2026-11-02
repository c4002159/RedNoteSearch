import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"

import { type FlowStatus, TasksService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import { SearchBox } from "@/components/Common/SearchBox"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
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
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FLOW_STATUS_LABEL } from "@/lib/zh"

export const Route = createFileRoute("/_layout/tasks/")({
  component: TasksPage,
  head: () => ({ meta: [{ title: "任务与版本历史 - RedNoteSearch" }] }),
})

const PAGE_SIZE = 20
const RUNNING = ["generating", "checking"]

function VersionHistory({ taskId }: { taskId: string }) {
  const versions = useQuery({
    queryKey: ["task-versions", taskId, "inline"],
    queryFn: async () =>
      (await TasksService.readTaskVersions({ path: { task_id: taskId } })).data,
  })
  const items = versions.data?.items ?? []
  return (
    <div>
      {versions.isLoading && <Skeleton className="mt-3 h-16 w-full" />}
      {versions.isError && (
        <div className="mt-3">
          <ErrorBanner
            error={parseApiError(versions.error)}
            onRetry={() => versions.refetch()}
          />
        </div>
      )}
      {versions.isSuccess && items.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">还没有生成版本。</p>
      )}
      {items.length > 0 && (
        <Table className="mt-3">
          <TableHeader>
            <TableRow className="bg-surface-low hover:bg-surface-low">
              <TableHead>版本号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((v) => {
              const prev = items
                .filter((x) => x.version_no < v.version_no)
                .sort((x, y) => y.version_no - x.version_no)[0]
              return (
                <TableRow key={v.id}>
                  <TableCell>第 {v.version_no} 版</TableCell>
                  <TableCell>
                    <FlowStatusBadge status={v.flow_status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTime(v.created_at)}
                  </TableCell>
                  <TableCell className="space-x-4 text-right text-[13px] font-medium">
                    <Link
                      className="text-link hover:underline"
                      to="/tasks/$taskId/versions/$versionId"
                      params={{ taskId, versionId: v.id }}
                    >
                      打开
                    </Link>
                    {prev && (
                      <Link
                        className="text-link hover:underline"
                        to="/tasks/$taskId/compare"
                        params={{ taskId }}
                        search={{ left: prev.id, right: v.id }}
                      >
                        对比
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (p: number) => void
}) {
  const nums = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2,
  )
  const btn =
    "flex size-8 items-center justify-center rounded-lg border border-border/60 text-[13px] hover:bg-accent disabled:opacity-40"
  return (
    <nav aria-label="分页" className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="上一页"
        className={btn}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹
      </button>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          aria-current={n === page ? "page" : undefined}
          className={cn(
            btn,
            n === page &&
              "border-primary bg-primary text-primary-foreground hover:bg-primary",
          )}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        aria-label="下一页"
        className={btn}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        ›
      </button>
    </nav>
  )
}

function TasksPage() {
  const { current } = useBrand()
  const brandId = current?.id ?? ""
  const [status, setStatus] = useState<FlowStatus | "">("")
  const [sort, setSort] = useState("-created_at")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  const tasks = useQuery({
    queryKey: ["tasks", brandId, status, sort, q, page],
    queryFn: async () =>
      (
        await TasksService.readTasks({
          query: {
            brand_id: brandId,
            status: status || undefined,
            sort,
            q: q || undefined,
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
          <p className="mb-1 text-xs text-muted-foreground">
            创作 &gt; 任务与版本历史
          </p>
          <h1 className="text-2xl font-bold tracking-tight">任务与版本历史</h1>
          <p className="text-sm text-muted-foreground">
            当前品牌的全部生成任务。点开任务可查看每个版本、对比两个版本。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={q}
            placeholder="搜索商品名或创作要求"
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
          <Button asChild>
            <Link to="/generate" search={{ task: undefined }}>
              新建任务
            </Link>
          </Button>
        </div>
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
      {tasks.data && (
        <div className="overflow-x-auto rounded-xl border border-border/40 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">
                  <HeaderFilter
                    title="创建时间"
                    showAll={false}
                    value={sort === "-created_at" ? "" : sort}
                    onChange={(v) => {
                      setSort(v === "" ? "-created_at" : v)
                      setPage(1)
                    }}
                    options={[
                      { value: "", label: "最新在前" },
                      { value: "created_at", label: "最早在前" },
                    ]}
                  />
                </TableHead>
                <TableHead>商品</TableHead>
                <TableHead>场景</TableHead>
                <TableHead className="whitespace-nowrap">
                  <HeaderFilter
                    title="状态"
                    value={status}
                    onChange={(v) => {
                      setStatus(v as FlowStatus | "")
                      setPage(1)
                    }}
                    options={Object.entries(FLOW_STATUS_LABEL).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </TableHead>
                <TableHead>最新版本</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {status || q
                      ? "没有符合条件的任务。"
                      : "还没有任务，到生成工作台创建第一个。"}
                  </TableCell>
                </TableRow>
              )}
              {tasks.data.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">
                    {formatTime(t.created_at)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {t.product_name ?? "—"}
                  </TableCell>
                  <TableCell>{t.scenario_name ?? "—"}</TableCell>
                  <TableCell>
                    <FlowStatusBadge status={t.flow_status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.latest_version_id ? "已有版本" : "版本 —"}
                  </TableCell>
                  <TableCell className="space-x-4 text-right text-[13px] font-medium">
                    <Link
                      className="text-link hover:underline"
                      to="/tasks/$taskId"
                      params={{ taskId: t.id }}
                    >
                      详情
                    </Link>
                    <button
                      type="button"
                      className="text-link hover:underline"
                      onClick={() => setOpen(t.id)}
                    >
                      查看
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tasks.data && tasks.data.total > 0 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            共 {tasks.data.total} 条
          </span>
          {totalPages > 1 && (
            <Pager page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
            <DialogDescription>
              打开某个版本，或把它和上一版对比。
            </DialogDescription>
          </DialogHeader>
          {open && <VersionHistory taskId={open} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
