import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import {
  CreativeTypesService,
  type ScenarioPublic,
  ScenariosService,
} from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { TemplateAnalysisTabs } from "@/components/Common/TemplateAnalysisTabs"
import { TypeBadge } from "@/components/Common/TypeBadge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import {
  SCENARIO_DETAIL_TEXT as D,
  label,
  R6_SAMPLE_TEXT as R,
  SCENE_LABEL,
  SCENARIO_TEXT as T,
  R6_TEMPLATE_TEXT as X,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/scenarios")({
  component: ScenariosPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})

const MAX_STRUCTURE = 2000

function ScenariosPage() {
  const brand = useBrand()
  const cache = useQueryClient()
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <ErrorBanner
        error={parseApiError(cache.getQueryState(["brands"])?.error)}
        onRetry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  return (
    <BrandScenarios
      key={brand.current.id}
      brandId={brand.current.id}
      isAdmin={brand.isAdmin}
    />
  )
}
function BrandScenarios({
  brandId,
  isAdmin,
}: {
  brandId: string
  isAdmin: boolean
}) {
  const cache = useQueryClient()
  const [editing, setEditing] = useState<ScenarioPublic | "new" | null>(null)
  const [viewing, setViewing] = useState<ScenarioPublic | null>(null)
  const [deleting, setDeleting] = useState<ScenarioPublic | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [sceneFilter, setSceneFilter] = useState("")
  const list = useQuery({
    queryKey: ["scenario-templates", brandId],
    queryFn: async () =>
      (
        await ScenariosService.readBrandTemplates({
          path: { brand_id: brandId },
        })
      ).data.items,
    enabled: !!brandId,
  })
  const types = useQuery({
    queryKey: ["creative-types", brandId],
    queryFn: async ({ signal }) =>
      (
        await CreativeTypesService.typesReadCreativeTypes({
          path: { brand_id: brandId },
          signal,
        })
      ).data.items,
  })
  const typeName = (key: string) =>
    types.data?.find((type) => type.key === key)?.name ??
    (SCENE_LABEL as Record<string, string>)[key] ??
    key
  const toggle = useMutation({
    mutationFn: async (row: ScenarioPublic) =>
      (
        await ScenariosService.updateTemplate({
          path: { template_id: row.id },
          body: { enabled: !row.enabled },
        })
      ).data,
    onSuccess: () => refresh(),
  })
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["scenario-templates"] }),
      cache.invalidateQueries({ queryKey: ["scenarios"] }),
    ])

  const rows = list.data ?? []
  const isDeleted = (row: ScenarioPublic) =>
    !row.enabled &&
    row.brand_id !== null &&
    !rows.some(
      (o) =>
        o.brand_id === row.brand_id &&
        o.scene === row.scene &&
        o.name === row.name &&
        o.template_version > row.template_version,
    )
  const filtered = rows.filter(
    (row) =>
      (!sceneFilter || row.scene === sceneFilter) &&
      (showDeleted || !isDeleted(row)),
  )
  const own = rows.filter((r) => r.brand_id === brandId)
  const newest = (r: ScenarioPublic) =>
    !own.some(
      (o) =>
        o.scene === r.scene &&
        o.name === r.name &&
        o.template_version > r.template_version,
    )
  const status = (row: ScenarioPublic) =>
    row.enabled ? T.on : newest(row) ? X.deleted : T.replaced
  const source = (row: ScenarioPublic) =>
    row.brand_id === null ? (
      <Pill tone="gray">{T.builtin}</Pill>
    ) : row.source_pattern_id ? (
      <Link
        to="/viral-patterns/$id"
        params={{ id: row.source_pattern_id }}
        className="text-link hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {row.source_pattern_title || T.fromViral}
      </Link>
    ) : row.source_pattern_title ? (
      <span>
        {row.source_pattern_title} · {D.sourceUnavailable}
      </span>
    ) : (
      D.noSource
    )

  return (
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => setEditing("new")}>{T.add}</Button>
          </div>
        )}
      </div>
      <TemplateAnalysisTabs />
      {toggle.isError && <ErrorBanner error={parseApiError(toggle.error)} />}
      <div className="flex items-center justify-end gap-4">
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-deleted-templates"
              checked={showDeleted}
              onCheckedChange={(checked) => setShowDeleted(checked === true)}
            />
            <label htmlFor="show-deleted-templates" className="text-sm">
              {X.showDeleted}
            </label>
          </div>
        )}
        <Button variant="ghost" onClick={() => setSceneFilter("")}>
          {D.clear}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-card shadow-sm">
        <Table className="min-w-[760px] text-sm [&_th]:bg-surface-low [&_th]:text-[13px] [&_th]:font-bold [&_th]:text-on-surface-variant">
          <TableHeader>
            <TableRow>
              <TableHead>{T.name}</TableHead>
              <TableHead aria-label={T.scene}>
                <HeaderFilter
                  title={T.scene}
                  value={sceneFilter}
                  onChange={setSceneFilter}
                  options={[
                    ...new Set([
                      ...Object.keys(SCENE_LABEL),
                      ...rows.map((row) => row.scene),
                    ]),
                  ].map((value) => ({
                    value,
                    label: typeName(value),
                  }))}
                />
              </TableHead>
              <TableHead>{T.version}</TableHead>
              <TableHead>{T.source}</TableHead>
              <TableHead>{T.status}</TableHead>
              {isAdmin && (
                <TableHead className="text-right">{D.actions}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5}>
                  <Skeleton className="h-48 w-full" />
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5}>
                  <ErrorBanner
                    error={parseApiError(list.error)}
                    onRetry={list.refetch}
                  />
                  {parseApiError(list.error).status === 403 && (
                    <ForbiddenPage
                      requestId={parseApiError(list.error).requestId}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const global = r.brand_id === null
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setViewing(r)}
                  >
                    <TableCell className="max-w-64 whitespace-normal break-words font-medium">
                      <button
                        type="button"
                        className="text-left text-link hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                        aria-label={`${D.view}：${r.name} v${r.template_version}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setViewing(r)
                        }}
                      >
                        {r.name}
                      </button>
                    </TableCell>
                    <TableCell className="min-w-28">
                      <TypeBadge typeKey={r.scene}>
                        {typeName(r.scene)}
                      </TypeBadge>
                    </TableCell>
                    <TableCell>v{r.template_version}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal break-words">
                      {source(r)}
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <Pill tone="ok">{T.on}</Pill>
                      ) : (
                        <Pill tone="gray">
                          {newest(r) ? X.deleted : T.replaced}
                        </Pill>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="space-x-2 text-right whitespace-nowrap">
                        {!global && newest(r) && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditing(r)
                              }}
                            >
                              {R.ownSave}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={toggle.isPending}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (r.enabled) setDeleting(r)
                                else toggle.mutate(r)
                              }}
                            >
                              {r.enabled ? X.delete : X.restore}
                            </Button>
                          </>
                        )}
                        {global && (
                          <span className="text-xs text-muted-foreground">
                            {X.builtinFixed}
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            )}
            {list.isSuccess && filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 6 : 5}
                  className="py-6 text-center text-muted-foreground"
                >
                  {sceneFilter ? D.filteredEmpty : T.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent className="border-0">
            <DialogHeader>
              <DialogTitle>{X.confirmTitle(deleting.name)}</DialogTitle>
              <DialogDescription>{X.confirmBody}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {X.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={toggle.isPending}
                onClick={() => {
                  toggle.mutate(deleting)
                  setDeleting(null)
                }}
              >
                {X.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {viewing && (
        <TemplateSheet
          key={viewing.id}
          row={viewing}
          brandId={brandId}
          isAdmin={isAdmin}
          typeName={typeName(viewing.scene)}
          source={source(viewing)}
          status={status(viewing)}
          onClose={() => setViewing(null)}
          onSaved={(saved) => {
            setViewing(saved)
            toast.success(
              saved.name !== viewing.name
                ? R.savedAsNew(saved.name)
                : R.savedVersion(saved.template_version),
            )
            void refresh()
          }}
        />
      )}
      {editing && isAdmin && (
        <TemplateDialog
          brandId={brandId}
          from={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            setViewing(saved)
            toast.success(
              editing !== "new" && saved.name !== editing.name
                ? R.savedAsNew(saved.name)
                : R.savedVersion(saved.template_version),
            )
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function TemplateDialog({
  brandId,
  from,
  onClose,
  onSaved,
}: {
  brandId: string
  from: ScenarioPublic | null
  onClose: () => void
  onSaved: (saved: ScenarioPublic) => void
}) {
  const [scene, setScene] = useState(from?.scene ?? "seeding")
  const [name, setName] = useState(from?.name ?? "")
  const [structure, setStructure] = useState(from?.structure ?? "")
  const save = useMutation({
    mutationFn: async () =>
      (
        await ScenariosService.createBrandTemplate({
          path: { brand_id: brandId },
          body: { scene, name: name.trim(), structure: structure.trim() },
        })
      ).data,
    onSuccess: onSaved,
  })
  const valid =
    !!name.trim() &&
    !!structure.trim() &&
    codePointCount(name.trim()) <= 100 &&
    codePointCount(structure.trim()) <= MAX_STRUCTURE
  const renamed = !!from && name.trim() !== from.name
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-2xl"
        showCloseButton={!save.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {from ? (renamed ? R.saveAsNew : R.ownSave) : T.add}
          </DialogTitle>
          <DialogDescription>
            {from
              ? `${from.name} v${from.template_version} · ${from.brand_id === null ? D.builtinCopy : D.newVersionHint}`
              : T.description}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <fieldset className="space-y-3" disabled={save.isPending}>
            <div className="space-y-1">
              <label htmlFor="tpl-scene" className="text-sm font-medium">
                {T.scene}
              </label>
              <select
                id="tpl-scene"
                className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-3 text-sm disabled:opacity-60"
                value={scene}
                disabled={!!from}
                onChange={(e) => setScene(e.target.value)}
              >
                {from && !(scene in SCENE_LABEL) && (
                  <option value={scene}>{label(SCENE_LABEL, scene)}</option>
                )}
                {Object.entries(SCENE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="tpl-name" className="text-sm font-medium">
                {T.name}
              </label>
              <Input
                id="tpl-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="tpl-structure" className="text-sm font-medium">
                {T.structure}
              </label>
              <Textarea
                id="tpl-structure"
                rows={8}
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{T.structureHint}</p>
              <CharCounter
                value={codePointCount(structure)}
                limit={MAX_STRUCTURE}
              />
            </div>
          </fieldset>
          {save.isError && <ErrorBanner error={parseApiError(save.error)} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton
              type="submit"
              loading={save.isPending}
              disabled={!valid}
            >
              {from ? (renamed ? R.saveAsNew : R.ownSave) : T.save}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TemplateSheet({
  row,
  brandId,
  isAdmin,
  source,
  typeName,
  status,
  onClose,
  onSaved,
}: {
  row: ScenarioPublic
  brandId: string
  isAdmin: boolean
  typeName: string
  source: ReactNode
  status: string
  onClose: () => void
  onSaved: (saved: ScenarioPublic) => void
}) {
  const [name, setName] = useState(row.name)
  const [structure, setStructure] = useState(row.structure)
  const save = useMutation({
    mutationFn: async () =>
      (
        await ScenariosService.createBrandTemplate({
          path: { brand_id: brandId },
          body: {
            scene: row.scene,
            name: name.trim(),
            structure: structure.trim(),
          },
        })
      ).data,
    onSuccess: onSaved,
  })
  const valid =
    !!name.trim() &&
    !!structure.trim() &&
    codePointCount(name.trim()) <= 100 &&
    codePointCount(structure.trim()) <= MAX_STRUCTURE
  const renamed = name.trim() !== row.name
  return (
    <Sheet open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent
        className="w-full gap-6 overflow-y-auto border-0 p-6 sm:max-w-2xl"
        onEscapeKeyDown={(e) => save.isPending && e.preventDefault()}
        onInteractOutside={(e) => save.isPending && e.preventDefault()}
      >
        <SheetHeader className="p-0 pr-6">
          <SheetTitle>
            {D.detail} · {row.name}
          </SheetTitle>
          <SheetDescription>
            {row.brand_id === null ? T.builtin : T.title} · v
            {row.template_version}
          </SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-2 gap-5 rounded-xl bg-surface-low p-5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{T.scene}</dt>
            <dd className="mt-1">
              <TypeBadge typeKey={row.scene}>{typeName}</TypeBadge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{T.version}</dt>
            <dd className="mt-1">v{row.template_version}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{T.source}</dt>
            <dd className="mt-1 break-words">{source}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{T.status}</dt>
            <dd className="mt-1">
              <Pill tone={row.enabled ? "ok" : "gray"}>{status}</Pill>
            </dd>
          </div>
        </dl>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (isAdmin && valid) save.mutate()
          }}
        >
          <fieldset className="space-y-4" disabled={save.isPending}>
            <div className="space-y-2">
              <label
                htmlFor="drawer-template-name"
                className="text-sm font-semibold"
              >
                {T.name}
              </label>
              <Input
                id="drawer-template-name"
                value={name}
                readOnly={!isAdmin}
                onChange={(e) => setName(e.target.value)}
              />
              <CharCounter value={codePointCount(name)} limit={100} />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="drawer-template-structure"
                className="text-sm font-semibold"
              >
                {T.structure}
              </label>
              <Textarea
                id="drawer-template-structure"
                rows={10}
                value={structure}
                readOnly={!isAdmin}
                onChange={(e) => setStructure(e.target.value)}
              />
              <CharCounter
                value={codePointCount(structure)}
                limit={MAX_STRUCTURE}
              />
            </div>
          </fieldset>
          <p className="text-xs leading-6 text-muted-foreground">
            {isAdmin
              ? renamed
                ? R.renameHint
                : row.brand_id === null
                  ? D.builtinCopy
                  : D.newVersionHint
              : D.readonly}
          </p>
          {save.isError && <ErrorBanner error={parseApiError(save.error)} />}
          <SheetFooter className="p-0 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {D.close}
            </Button>
            {isAdmin && (
              <LoadingButton
                type="submit"
                loading={save.isPending}
                disabled={!valid}
              >
                {renamed
                  ? R.saveAsNew
                  : row.brand_id === null
                    ? R.builtinSave
                    : R.ownSave}
              </LoadingButton>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
