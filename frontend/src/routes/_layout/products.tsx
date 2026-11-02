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
import { LoadingState } from "@/components/Common/LoadingState"
import { Pager } from "@/components/Knowledge/Feedback"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useBrand } from "@/hooks/useBrand"
import {
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
  const [status, setStatus] = useState<ProductStatus>("active"),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<ProductPublic | "new" | null>(null),
    [viewing, setViewing] = useState<ProductPublic | null>(null),
    [archive, setArchive] = useState<ProductPublic | null>(null)
  const query = useQuery({
    queryKey: ["catalog-products", id, status, page],
    queryFn: async ({ signal }) =>
      (
        await ProductsService.readProducts({
          path: { brand_id: id },
          query: { status, page, page_size: 20 },
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
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.products}</h1>
          <p className="text-sm text-muted-foreground">{T.productHint}</p>
        </div>
        {brand.isAdmin && (
          <Button onClick={() => setEditing("new")}>{T.newProduct}</Button>
        )}
      </div>
      <div className="flex gap-2 rounded-xl bg-card p-6 shadow-sm">
        {(["active", "archived"] as const).map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            onClick={() => {
              setStatus(s)
              setPage(1)
            }}
          >
            {label(PRODUCT_STATUS_LABEL, s)}
          </Button>
        ))}
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
          <ul className="space-y-3">
            {query.data.items.map((p) => (
              <li
                key={p.id}
                className="space-y-3 rounded-xl bg-card p-6 shadow-sm"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-medium">{p.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {p.product_line || T.none} ·{" "}
                      {label(BRAND_CATEGORY_LABEL, p.category)} ·{" "}
                      {label(PRODUCT_STATUS_LABEL, p.status)}
                    </p>
                    <p className="text-sm">
                      {T.pointCount}：
                      {
                        p.selling_points.filter(
                          (s) => s.evidence_status === "linked",
                        ).length
                      }{" "}
                      / {p.selling_points.length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-link"
                      onClick={() => setViewing(p)}
                    >
                      {T.view}
                    </Button>
                    {brand.isAdmin && p.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-link"
                          onClick={() => setEditing(p)}
                        >
                          {T.edit}
                        </Button>
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
                </div>
              </li>
            ))}
          </ul>
        ))}
      {query.data && !query.isError && (
        <Pager page={page} total={query.data.total} onPage={setPage} />
      )}{" "}
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
                {viewing.product_line || T.none} ·{" "}
                {label(BRAND_CATEGORY_LABEL, viewing.category)}
              </DialogDescription>
            </DialogHeader>
            {(["top", "middle", "base"] as const).map((k) => (
              <p key={k} className="break-words text-sm">
                {T[k]}：{viewing.notes[k]?.join("、") || T.none}
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
            <p className="break-words text-sm">
              {T.restricted}：{viewing.restricted_claims.join("、") || T.none}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
