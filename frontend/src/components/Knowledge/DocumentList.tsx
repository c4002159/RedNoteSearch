import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import {
  type DocumentStatus,
  type DocumentType,
  KnowledgeService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { LoadingState } from "@/components/Common/LoadingState"
import { DocumentStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  label,
  KB_TEXT as T,
} from "@/lib/zh"
import { IndexBadge, KnowledgeError, Pager } from "./Feedback"
import { UploadDocument } from "./UploadDocument"

export function DocumentList({ review = false }: { review?: boolean }) {
  const brand = useBrand()
  const cache = useQueryClient()
  if (brand.isLoading) return <LoadingState className="h-48 w-full" />
  if (brand.isError)
    return (
      <KnowledgeError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (review && !brand.isAdmin) return <ForbiddenPage />
  return (
    <BrandDocuments
      key={brand.current.id}
      brandId={brand.current.id}
      admin={brand.isAdmin}
      review={review}
    />
  )
}
function BrandDocuments({
  brandId,
  admin,
  review,
}: {
  brandId: string
  admin: boolean
  review: boolean
}) {
  const client = useQueryClient(),
    navigate = useNavigate()
  const [status, setStatus] = useState<DocumentStatus | "">("")
  const [type, setType] = useState<DocumentType | "">("")
  const [page, setPage] = useState(1)
  const [upload, setUpload] = useState(false)
  const documents = useQuery({
    queryKey: ["knowledge", brandId, review, status, type, page],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: {
            status: review ? "pending_review" : status || undefined,
            doc_type: type || undefined,
            page,
            page_size: 20,
          },
          signal,
        })
      ).data,
  })
  const pending = useQuery({
    queryKey: ["knowledge-pending", brandId],
    queryFn: async () =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: { status: "pending_review", page: 1, page_size: 1 },
        })
      ).data.total,
    enabled: admin,
  })
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {review ? T.reviewTitle : T.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {review ? T.queueDescription : T.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {review ? (
            <Button asChild variant="outline">
              <Link to="/knowledge">{T.back}</Link>
            </Button>
          ) : (
            <>
              {admin && (
                <Button asChild variant="outline">
                  <Link to="/knowledge/review">
                    {T.queue}
                    {pending.data !== undefined ? ` (${pending.data})` : ""}
                  </Link>
                </Button>
              )}
              <Button onClick={() => setUpload(true)}>
                {admin ? T.upload : T.submit}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-3">
        {!review && (
          <select
            aria-label={T.status}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as DocumentStatus | "")
              setPage(1)
            }}
          >
            <option value="">{T.allStatus}</option>
            {Object.entries(DOCUMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={T.type}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={type}
          onChange={(e) => {
            setType(e.target.value as DocumentType | "")
            setPage(1)
          }}
        >
          <option value="">{T.allTypes}</option>
          {Object.entries(DOCUMENT_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          onClick={() => {
            setType("")
            setStatus("")
            setPage(1)
          }}
        >
          {T.clear}
        </Button>
      </div>
      {documents.isLoading && <LoadingState className="h-48 w-full" />}
      {documents.isError && (
        <KnowledgeError
          error={documents.error}
          retry={() => documents.refetch()}
        />
      )}
      {documents.data &&
        !documents.isError &&
        (documents.data.items.length === 0 ? (
          <EmptyState
            title={
              review ? T.noPending : status || type ? T.filteredEmpty : T.empty
            }
            description={T.emptyHint}
          />
        ) : (
          <div className="min-w-0 rounded-xl border bg-card">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/3">{T.documentTitle}</TableHead>
                  <TableHead>{T.type}</TableHead>
                  <TableHead>{review ? T.relation : T.status}</TableHead>
                  <TableHead>{review ? T.version : T.index}</TableHead>
                  <TableHead>{T.author}</TableHead>
                  <TableHead>{T.created}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      <Link
                        className="font-medium text-link hover:underline"
                        to="/knowledge/$id"
                        params={{ id: row.id }}
                      >
                        {row.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        v{row.version} ·{" "}
                        {row.is_current ? T.current : T.history}
                      </p>
                      {review && (
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/knowledge/$id" params={{ id: row.id }}>
                            {T.review}
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {label(DOCUMENT_TYPE_LABEL, row.doc_type)}
                    </TableCell>
                    <TableCell>
                      {review ? (
                        row.version > 1 ? (
                          T.update
                        ) : (
                          T.newDocument
                        )
                      ) : (
                        <DocumentStatusBadge status={row.status} />
                      )}
                    </TableCell>
                    <TableCell>
                      {review ? (
                        `v${row.version}`
                      ) : (
                        <IndexBadge
                          documentStatus={row.status}
                          status={row.index_status}
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      {row.submitted_by_name || T.unknown}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      {formatTime(row.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      {documents.data && !documents.isError && (
        <Pager page={page} total={documents.data.total} onPage={setPage} />
      )}
      {upload && (
        <UploadDocument
          brandId={brandId}
          admin={admin}
          onClose={() => setUpload(false)}
          onSaved={(row) => {
            setUpload(false)
            void client.invalidateQueries({ queryKey: ["knowledge"] })
            void client.invalidateQueries({ queryKey: ["knowledge-pending"] })
            void navigate({ to: "/knowledge/$id", params: { id: row.id } })
          }}
        />
      )}
    </div>
  )
}
