import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { type DocumentDetail, KnowledgeService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { LoadingState } from "@/components/Common/LoadingState"
import { ReasonDialog } from "@/components/Common/ReasonDialog"
import { DocumentStatusBadge, Pill } from "@/components/Common/StatusBadge"
import {
  IndexBadge,
  KnowledgeError,
  Pager,
} from "@/components/Knowledge/Feedback"
import { UploadDocument } from "@/components/Knowledge/UploadDocument"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import {
  DOCUMENT_TYPE_LABEL,
  label,
  REVIEW_ACTION_LABEL,
  KB_TEXT as T,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/knowledge/$id")({
  component: DocumentPage,
  head: () => ({ meta: [{ title: `${T.detailTitle} - RedNoteSearch` }] }),
})
function Chunks({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ["knowledge-chunks", id, page],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readChunks({
          path: { document_id: id },
          query: { page, page_size: 10 },
          signal,
        })
      ).data,
  })
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{T.chunks}</h2>
      {query.isLoading && <LoadingState className="h-24 w-full" />}
      {query.isError && (
        <KnowledgeError error={query.error} retry={() => query.refetch()} />
      )}
      {query.data &&
        (query.data.items.length === 0 ? (
          <EmptyState title={T.noChunks} />
        ) : (
          query.data.items.map((row) => (
            <article key={row.id} className="space-y-2 rounded-lg border p-3">
              <h3 className="text-xs text-muted-foreground">
                {T.chunk} {row.chunk_index + 1}
              </h3>
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                {row.content}
              </p>
            </article>
          ))
        ))}
      {query.data && (
        <Pager
          page={page}
          total={query.data.total}
          size={10}
          onPage={setPage}
        />
      )}
    </section>
  )
}
function DocumentPage() {
  const { id } = Route.useParams()
  const brand = useBrand()
  const cache = useQueryClient()
  const query = useQuery({
    queryKey: ["knowledge-document", id],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readDocument({
          path: { document_id: id },
          signal,
        })
      ).data,
    enabled: !!brand.current,
    retry: (n, error) =>
      n < 2 && ![401, 403, 404, 422].includes(parseApiError(error).status ?? 0),
  })
  if (brand.isLoading || query.isLoading)
    return <LoadingState className="h-48 w-full" />
  if (brand.isError)
    return (
      <KnowledgeError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (query.isError)
    return <KnowledgeError error={query.error} retry={() => query.refetch()} />
  if (!query.data) return null
  if (query.data.brand_id !== brand.current.id) return <ForbiddenPage />
  return (
    <DocumentView
      key={id}
      row={query.data}
      admin={brand.isAdmin}
      brandId={brand.current.id}
    />
  )
}
function DocumentView({
  row,
  admin,
  brandId,
}: {
  row: DocumentDetail
  admin: boolean
  brandId: string
}) {
  const client = useQueryClient(),
    navigate = useNavigate()
  const [upload, setUpload] = useState(false)
  const [action, setAction] = useState<
    "approve" | "reject" | "deactivate" | null
  >(null)
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["knowledge"] }),
      client.invalidateQueries({ queryKey: ["knowledge-document", row.id] }),
      client.invalidateQueries({ queryKey: ["knowledge-chunks", row.id] }),
      client.invalidateQueries({ queryKey: ["knowledge-pending"] }),
    ])
  }
  const operation = useMutation({
    mutationFn: async ({
      kind,
      reason,
    }: {
      kind: "approve" | "reject" | "deactivate" | "reindex"
      reason?: string
    }) => {
      const path = { document_id: row.id }
      return kind === "reindex"
        ? (await KnowledgeService.reindexDocument({ path, timeout: 600_000 }))
            .data
        : kind === "deactivate"
          ? (
              await KnowledgeService.deactivateDocument({
                path,
                body: { reason },
                timeout: 600_000,
              })
            ).data
          : (
              await KnowledgeService.reviewDocument({
                path,
                body: { action: kind, reason },
                timeout: 600_000,
              })
            ).data
    },
    onSuccess: (_, variables) => {
      setAction(null)
      toast.success(
        variables.kind === "reindex"
          ? T.reindexed
          : variables.kind === "deactivate"
            ? T.deactivated
            : T.reviewSaved,
      )
      void refresh()
    },
    onError: () => {
      setAction(null)
      void refresh()
    },
  })
  const busy = operation.isPending
  return (
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost">
        <Link to="/knowledge">{T.back}</Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-2xl font-bold">{row.title}</h1>
          <p className="text-sm text-muted-foreground">
            {label(DOCUMENT_TYPE_LABEL, row.doc_type)} · v{row.version} ·{" "}
            {row.submitted_by_name || T.unknown} · {formatTime(row.created_at)}
          </p>
          <div className="flex flex-wrap gap-2">
            <DocumentStatusBadge status={row.status} />
            <IndexBadge status={row.index_status} documentStatus={row.status} />
            <Pill tone="gray">{row.is_current ? T.current : T.history}</Pill>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin && row.status === "pending_review" && (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  operation.reset()
                  setAction("approve")
                }}
              >
                {T.approve}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  operation.reset()
                  setAction("reject")
                }}
              >
                {T.reject}
              </Button>
            </>
          )}
          {admin && row.status === "approved" && (
            <>
              <LoadingButton
                variant="outline"
                loading={busy}
                onClick={() => operation.mutate({ kind: "reindex" })}
              >
                {busy ? T.processing : T.reindex}
              </LoadingButton>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  operation.reset()
                  setAction("deactivate")
                }}
              >
                {T.deactivate}
              </Button>
            </>
          )}
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => setUpload(true)}
          >
            {admin ? T.uploadVersion : T.submitVersion}
          </Button>
        </div>
      </div>
      {row.status === "deactivated" && (
        <p className="rounded-lg bg-surface p-3 text-sm">{T.deactivatedHint}</p>
      )}
      {row.status === "approved" && row.index_status !== "ready" && (
        <p
          role="status"
          className={
            row.index_status === "failed"
              ? "rounded-lg bg-error-container p-3 text-sm text-on-error-container"
              : "rounded-lg bg-surface p-3 text-sm"
          }
        >
          {row.index_status === "failed" ? T.failedHint : T.pendingHint}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {T.processing} {T.longRequest}
        </p>
      )}
      {operation.isError && <KnowledgeError error={operation.error} />}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-semibold">{T.metadata}</h2>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          {[
            [T.id, row.id],
            [T.group, row.group_id],
            [T.filename, row.source_filename || "—"],
            [T.author, row.submitted_by_name || T.unknown],
          ].map(([name, value]) => (
            <div className="min-w-0" key={name}>
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {admin && <Chunks id={row.id} />}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.versions}</h2>
        <ul className="space-y-2">
          {row.versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
            >
              <Link
                className="text-link hover:underline"
                to="/knowledge/$id"
                params={{ id: version.id }}
              >
                v{version.version}
              </Link>
              <DocumentStatusBadge status={version.status} />
              <Pill tone="gray">
                {version.is_current ? T.current : T.history}
              </Pill>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.reviews}</h2>
        {row.reviews.length === 0 ? (
          <EmptyState title={T.noReviews} />
        ) : (
          <ol className="space-y-3">
            {row.reviews.map((entry, i) => (
              <li
                key={`${entry.created_at}-${i}`}
                className="space-y-1 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{label(REVIEW_ACTION_LABEL, entry.action)}</strong>
                  <span className="text-muted-foreground">
                    {formatTime(entry.created_at)}
                  </span>
                </div>
                <p>
                  {T.actor}：{entry.actor_name || T.unknown}
                </p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {T.reason}：{entry.reason || "—"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {upload && (
        <UploadDocument
          brandId={brandId}
          admin={admin}
          previous={row}
          onClose={() => setUpload(false)}
          onSaved={(result) => {
            setUpload(false)
            void refresh()
            void navigate({ to: "/knowledge/$id", params: { id: result.id } })
          }}
        />
      )}
      {action && admin && (
        <ReasonDialog
          key={action}
          open
          title={T[action]}
          description={`${row.title} · v${row.version}。${action === "approve" ? T.approveDescription : action === "reject" ? T.rejectDescription : T.deactivateDescription}`}
          confirmLabel={T[action]}
          variant={action === "approve" ? "default" : "destructive"}
          pending={busy}
          onCancel={() => setAction(null)}
          onConfirm={(reason) => operation.mutate({ kind: action, reason })}
        />
      )}
    </div>
  )
}
