import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { MoreHorizontal, Plus } from "lucide-react"
import { useState } from "react"
import { CreativeTypesService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import {
  type TypeAction,
  TypeDialog,
} from "@/components/CreativeTypes/TypeDialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  CREATIVE_TYPE_DIALOG_TEXT as D,
  PAGE_ERROR_TEXT,
  CREATIVE_TYPES_TEXT as T,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/creative-types")({
  component: Page,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})

export function CreativeTypeError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const info = parseApiError(error)
  return (
    <div className="space-y-3">
      <ErrorBanner
        error={{
          ...info,
          message: /[\u3400-\u9fff]/.test(info.message)
            ? info.message
            : (PAGE_ERROR_TEXT.status[info.status ?? 0] ??
              PAGE_ERROR_TEXT.failed),
        }}
        onRetry={retry}
      />
      {info.status === 403 && <ForbiddenPage requestId={info.requestId} />}
    </div>
  )
}

function Page() {
  const brand = useBrand(),
    cache = useQueryClient()
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <CreativeTypeError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  return (
    <TypeList
      key={brand.current.id}
      brandId={brand.current.id}
      brandName={brand.current.name}
      admin={brand.isAdmin}
    />
  )
}

function TypeList({
  brandId,
  brandName,
  admin,
}: {
  brandId: string
  brandName: string
  admin: boolean
}) {
  const cache = useQueryClient()
  const [action, setAction] = useState<TypeAction | null>(null)
  const list = useQuery({
    queryKey: ["creative-types", brandId],
    queryFn: async ({ signal }) =>
      (
        await CreativeTypesService.typesReadCreativeTypes({
          path: { brand_id: brandId },
          signal,
        })
      ).data.items,
  })
  const rows = [...(list.data ?? [])].sort(
    (a, b) => Number(b.builtin) - Number(a.builtin),
  )
  return (
    <div className="min-w-0 space-y-6">
      <nav
        aria-label={T.breadcrumb}
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Link to="/scenarios" className="text-link hover:underline">
          {T.group}
        </Link>
        <span aria-hidden>›</span>
        <span>{T.title}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            {T.description}
          </p>
        </div>
        {admin ? (
          <Button onClick={() => setAction({ kind: "create" })}>
            <Plus />
            {D.create}
          </Button>
        ) : (
          <Pill tone="info">{T.readonly}</Pill>
        )}
      </header>
      <section className="min-w-0 space-y-5 rounded-xl bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <Pill tone="info">
            {list.isSuccess
              ? T.total(rows.length, rows.filter((r) => r.builtin).length)
              : T.loading}
          </Pill>
          <span className="text-muted-foreground">
            {T.workspace}
            {brandName}
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[700px] text-sm [&_th]:bg-surface-low [&_th]:text-[13px] [&_th]:font-bold [&_td]:py-5">
            <TableHeader>
              <TableRow>
                {[
                  T.name,
                  T.identifier,
                  T.source,
                  T.count,
                  ...(admin ? [T.actions] : []),
                ].map((text) => (
                  <TableHead key={text}>{text}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <TableRow>
                  <TableCell colSpan={admin ? 5 : 4}>
                    <Skeleton className="h-56 w-full" />
                    <p className="sr-only">{T.loading}</p>
                  </TableCell>
                </TableRow>
              ) : list.isError ? (
                <TableRow>
                  <TableCell colSpan={admin ? 5 : 4}>
                    <CreativeTypeError
                      error={list.error}
                      retry={() => list.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={admin ? 5 : 4}>
                    <EmptyState title={T.empty} />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.builtin ? (
                        row.name
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground">
                          {row.key}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Pill tone={row.builtin ? "info" : "gray"}>
                        {row.builtin ? T.builtin : T.custom}
                      </Pill>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.template_count}
                    </TableCell>
                    {admin && (
                      <TableCell>
                        {row.builtin ? (
                          "—"
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={D.menu(row.name)}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  setAction({ kind: "rename", row })
                                }
                              >
                                {D.rename}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() =>
                                  setAction({ kind: "delete", row })
                                }
                              >
                                {D.remove}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <footer className="space-y-2 text-xs text-muted-foreground">
          <p>{T.builtinHint}</p>
          <p>{admin ? T.deleteHint : T.readonlyHint}</p>
        </footer>
      </section>
      {action && admin && (
        <TypeDialog
          brandId={brandId}
          action={action}
          onClose={() => setAction(null)}
          onSaved={async () => {
            await cache.invalidateQueries({
              queryKey: ["creative-types", brandId],
            })
          }}
        />
      )}
    </div>
  )
}
