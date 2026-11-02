import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import {
  type ProductPublic,
  type ProductStatus,
  ProductsService,
} from "@/client"
import { BrandConfirm, BrandError } from "@/components/Brands/Feedback"
import { CatalogGuard } from "@/components/Catalog/Fields"
import { ProductForm } from "@/components/Catalog/ProductForm"
import { SourceReference } from "@/components/Catalog/Sources"
import { EmptyState } from "@/components/Common/EmptyState"
import { FilterSelect } from "@/components/Common/FilterSelect"
import { LoadingState } from "@/components/Common/LoadingState"
import { SearchBox } from "@/components/Common/SearchBox"
import { SimplePager } from "@/components/Common/SimplePager"
import {
  TableBatchBar,
  TableSelectAll,
  TableSelectRow,
} from "@/components/Common/TableBatchBar"
import { TableBatchDialog } from "@/components/Common/TableBatchDialog"
import { TableName } from "@/components/Common/TableName"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import {
  TABLE_TEXT as B,
  BRAND_CATEGORY_LABEL,
  label,
  PRODUCT_STATUS_LABEL,
  CATALOG_TEXT as T,
} from "@/lib/zh"
export const Route = createFileRoute("/_layout/products")({
  component: () => (
    <CatalogGuard>
      <ProductsPage />
    </CatalogGuard>
  ),
  head: () => ({ meta: [{ title: `${T.products} - RedNoteSearch` }] }),
})
function ProductsPage() {
  const brand = useBrand(),
    id = brand.current!.id,
    cache = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<string[] | null>(null)
  const [status, setStatus] = useState<ProductStatus>("active"),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<ProductPublic | "new" | null>(null),
    [viewing, setViewing] = useState<ProductPublic | null>(null),
    [archive, setArchive] = useState<ProductPublic | null>(null)
  const query = useQuery({
    queryKey: ["catalog-products", id, status, q, page],
    queryFn: async ({ signal }) =>
      (
        await ProductsService.readProducts({
          path: { brand_id: id },
          query: { status, q: q || undefined, page, page_size: 20 },
          signal,
        })
      ).data,
  })
  const refresh = () => {
    toast.success(T.saved)
    void cache.invalidateQueries({ queryKey: ["catalog-products", id] })
    void cache.invalidateQueries({ queryKey: ["products", id] })
  }
  const mutation = useMutation({
    mutationFn: () =>
      ProductsService.archiveProduct({ path: { product_id: archive!.id } }),
    onSuccess: () => {
      setArchive(null)
      refresh()
    },
  })
  const selection = {
    selected,
    onChange: setSelected,
    pageIds: query.data?.items.map((row) => row.id) ?? [],
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{T.products}</h1>
            <FilterSelect
              title="状态"
              value={status}
              onChange={(v) => {
                setSelected(new Set())
                setStatus(v as ProductStatus)
                setPage(1)
              }}
              options={(["active", "archived"] as const).map((value) => ({
                value,
                label: label(PRODUCT_STATUS_LABEL, value),
              }))}
            />
          </div>
          <p className="text-sm text-muted-foreground">{T.productHint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SearchBox
            value={q}
            placeholder="搜索商品名称或产品线"
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
          {brand.isAdmin && (
            <Button onClick={() => setEditing("new")}>{T.newProduct}</Button>
          )}
        </div>
      </div>
      {query.isLoading && <LoadingState className="h-40 w-full" />}
      {query.isError && (
        <BrandError error={query.error} retry={() => query.refetch()} />
      )}{" "}
      {query.data &&
        !query.isError &&
        (query.data.items.length === 0 ? (
          <EmptyState title={T.emptyProducts} />
        ) : (
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            {brand.isAdmin && status === "active" && (
              <TableBatchBar
                {...selection}
                total={query.data.total}
                loadAll={async () =>
                  (
                    await ProductsService.readProducts({
                      path: { brand_id: id },
                      query: {
                        status,
                        q: q || undefined,
                        page: 1,
                        page_size: 50,
                      },
                    })
                  ).data.items.map((row) => row.id)
                }
                actions={[
                  {
                    label: B.archive,
                    destructive: true,
                    onSelect: () => setBatch([...selected]),
                  },
                ]}
              />
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  {brand.isAdmin && status === "active" && (
                    <TableHead className="w-12">
                      <TableSelectAll {...selection} />
                    </TableHead>
                  )}
                  {[
                    B.name,
                    B.line,
                    B.category,
                    B.points,
                    B.status,
                    B.actions,
                  ].map((title) => (
                    <TableHead key={title}>{title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((p) => (
                  <TableRow key={p.id}>
                    {brand.isAdmin && status === "active" && (
                      <TableCell>
                        <TableSelectRow
                          {...selection}
                          id={p.id}
                          label={p.name}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-normal">
                      <TableName onClick={() => setViewing(p)}>
                        {p.name}
                      </TableName>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-normal">
                      {p.product_line}
                    </TableCell>
                    <TableCell>
                      {label(BRAND_CATEGORY_LABEL, p.category)}
                    </TableCell>
                    <TableCell variant="secondary">
                      {
                        p.selling_points.filter(
                          (point) => point.evidence_status === "linked",
                        ).length
                      }{" "}
                      / {p.selling_points.length}
                    </TableCell>
                    <TableCell>
                      {label(PRODUCT_STATUS_LABEL, p.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-link hover:underline"
                          onClick={() => setViewing(p)}
                        >
                          {T.view}
                        </Button>
                        {brand.isAdmin && p.status === "active" && (
                          <>
                            <TableName editable onClick={() => setEditing(p)}>
                              {T.edit}
                            </TableName>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                mutation.reset()
                                setArchive(p)
                              }}
                            >
                              {T.archive}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))}
      {query.data && !query.isError && (
        <SimplePager page={page} total={query.data.total} onPage={setPage} />
      )}{" "}
      {batch && brand.isAdmin && (
        <TableBatchDialog
          ids={batch}
          title={B.archive}
          execute={(product_id) =>
            ProductsService.archiveProduct({ path: { product_id } })
          }
          onClose={() => setBatch(null)}
          onApplied={(ids) => {
            setSelected(
              (previous) =>
                new Set([...previous].filter((id) => !ids.includes(id))),
            )
            if (ids.length) {
              setPage(1)
              refresh()
            }
          }}
        />
      )}
      {brand.isAdmin && editing && (
        <ProductForm
          brandId={id}
          product={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {brand.isAdmin && archive && (
        <BrandConfirm
          title={`${T.archive} ${archive.name}`}
          description={T.archiveHint}
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setArchive(null)}
          onConfirm={() => mutation.mutate()}
        />
      )}{" "}
      {viewing && (
        <Dialog open onOpenChange={(o) => !o && setViewing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{viewing.name}</DialogTitle>
              <DialogDescription>
                {viewing.product_line} ·{" "}
                {label(BRAND_CATEGORY_LABEL, viewing.category)}
              </DialogDescription>
            </DialogHeader>
            {(["top", "middle", "base"] as const)
              .filter((k) => viewing.notes[k]?.length)
              .map((k) => (
                <p key={k} className="break-words text-sm">
                  {T[k]}：{viewing.notes[k]?.join("、")}
                </p>
              ))}
            <h3>{T.points}</h3>
            {viewing.selling_points.map((p, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <p className="break-words text-sm">{p.text}</p>
                <p className="text-xs">
                  {p.evidence_status === "linked"
                    ? T.linked
                    : p.evidence_status === "draft"
                      ? T.draft
                      : p.evidence_status}
                </p>
                <SourceReference point={p} admin={brand.isAdmin} />
              </div>
            ))}
            {viewing.restricted_claims.length > 0 && (
              <p className="break-words text-sm">
                {T.restricted}：{viewing.restricted_claims.join("、")}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
