import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { type GenerationVersionPublic, TasksService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiError } from "@/lib/apiError"
import { diffLines } from "@/lib/diff"
import { T5_VISUAL_TEXT as T } from "@/lib/zh"

export const Route = createFileRoute("/_layout/tasks/$taskId/compare")({
  validateSearch: (s: Record<string, unknown>) => ({
    left: typeof s.left === "string" ? s.left : "",
    right: typeof s.right === "string" ? s.right : "",
  }),
  component: ComparePage,
  head: () => ({ meta: [{ title: "版本对比 - RedNoteSearch" }] }),
})
// The supported browsers implement Segmenter; the project's TS lib predates its declaration.
const Segmenter = Reflect.get(Intl, "Segmenter") as new (
  locale: string,
  options: { granularity: "word" },
) => { segment: (text: string) => Iterable<{ segment: string }> }
const segmenter = new Segmenter("zh", { granularity: "word" })
const words = (text: string) =>
  Array.from(segmenter.segment(text), (part) => part.segment)

function ComparedText({
  left,
  right,
  side,
}: {
  left: string
  right: string
  side: "left" | "right"
}) {
  return diffLines(words(left), words(right)).map((row, index) =>
    row[side] === null ? null : (
      <span
        key={index}
        className={
          row.same
            ? undefined
            : side === "left"
              ? "rounded bg-tone-err-bg text-tone-err line-through decoration-current"
              : "rounded bg-tone-ok-bg text-tone-ok"
        }
      >
        {row[side]}
      </span>
    ),
  )
}

function VersionCard({
  version,
  other,
  versions,
  side,
}: {
  version: GenerationVersionPublic
  other: GenerationVersionPublic
  versions: GenerationVersionPublic[]
  side: "left" | "right"
}) {
  const navigate = Route.useNavigate()
  const text = (value: string, otherValue: string) => (
    <ComparedText
      left={side === "left" ? value : otherValue}
      right={side === "left" ? otherValue : value}
      side={side}
    />
  )
  return (
    <section className="min-w-0 space-y-6 rounded-xl bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface pb-5">
        <select
          aria-label={side === "left" ? T.leftVersion : T.rightVersion}
          className="h-10 rounded-lg border-0 bg-surface-low px-3 text-sm font-medium focus-visible:outline-ring"
          value={version.id}
          onChange={(event) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                ...(event.target.value === other.id
                  ? { [side === "left" ? "right" : "left"]: version.id }
                  : {}),
                [side]: event.target.value,
              }),
            })
          }
        >
          {versions.map((item) => (
            <option key={item.id} value={item.id}>
              {T.version} {item.version_no}
            </option>
          ))}
        </select>
        <FlowStatusBadge status={version.flow_status} />
      </div>
      {(
        ["title_candidates", "body", "hashtags", "cover_candidates"] as const
      ).map((field) => (
        <div key={field} className="space-y-3">
          <h2 className="text-base font-semibold">{T[field]}</h2>
          {field === "body" ? (
            <p className="min-h-24 whitespace-pre-wrap rounded-lg bg-surface-low p-5 text-sm leading-7 [overflow-wrap:anywhere]">
              {text(version.body, other.body)}
            </p>
          ) : version[field].length === 0 ? (
            <p className="text-sm text-muted-foreground">{T.emptyContent}</p>
          ) : field === "hashtags" ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {version.hashtags.map((tag, index) => (
                <li
                  key={index}
                  className="max-w-full break-words rounded-full bg-surface-low px-3 py-1.5"
                >
                  {text(
                    `#${tag.replace(/^#+/, "")}`,
                    other.hashtags.includes(tag)
                      ? `#${tag.replace(/^#+/, "")}`
                      : "",
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <ol className="space-y-3">
              {version[field].map((value, index) => (
                <li
                  key={index}
                  className="rounded-lg border border-surface px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere]"
                >
                  {index + 1}. {text(value, other[field][index] ?? "")}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </section>
  )
}
function ComparePage() {
  const { taskId } = Route.useParams()
  const { left, right } = Route.useSearch()
  const versions = useQuery({
    queryKey: ["task-versions", taskId, "compare"],
    queryFn: async () =>
      (await TasksService.readTaskVersions({ path: { task_id: taskId } })).data
        .items,
  })
  const a = versions.data?.find((v) => v.id === left)
  const b = versions.data?.find((v) => v.id === right)
  return (
    <div className="space-y-6">
      <nav
        aria-label={T.breadcrumb}
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Link to="/tasks" className="hover:text-link">
          {T.tasks}
        </Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span className="font-medium text-foreground">{T.compare}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface pb-5">
        <h1 className="text-2xl font-bold tracking-tight">{T.compare}</h1>
        <Button asChild variant="outline" size="sm">
          {b ? (
            <Link
              to="/tasks/$taskId/versions/$versionId"
              params={{ taskId, versionId: b.id }}
            >
              <ArrowLeft className="size-4" />
              {T.backResult}
            </Link>
          ) : (
            <Link to="/tasks/$taskId" params={{ taskId }}>
              {T.backTask}
            </Link>
          )}
        </Button>
      </div>
      {versions.isLoading && <Skeleton className="h-48 w-full" />}
      {versions.isError &&
        (parseApiError(versions.error).status === 404 ? (
          <MissingPage />
        ) : (
          <ErrorBanner
            error={parseApiError(versions.error)}
            onRetry={() => versions.refetch()}
          />
        ))}
      {versions.isSuccess && (!a || !b || a.id === b.id) && (
        <EmptyState title={T.chooseVersions} description={T.chooseHint} />
      )}
      {a && b && a.id !== b.id && versions.data && (
        <>
          <div className="flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-3 rounded bg-tone-err-bg ring-1 ring-tone-err/30" />
              {T.leftOnly}
            </span>
            <span className="flex items-center gap-2">
              <span className="size-3 rounded bg-tone-ok-bg ring-1 ring-tone-ok/30" />
              {T.rightOnly}
            </span>
          </div>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <VersionCard
              version={a}
              other={b}
              versions={versions.data}
              side="left"
            />
            <VersionCard
              version={b}
              other={a}
              versions={versions.data}
              side="right"
            />
          </div>
        </>
      )}
    </div>
  )
}
