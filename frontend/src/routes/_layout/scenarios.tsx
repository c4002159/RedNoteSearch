import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { type ScenarioPublic, ScenariosService, type Scene } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
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
import { SCENE_LABEL, SCENARIO_TEXT as T } from "@/lib/zh"

export const Route = createFileRoute("/_layout/scenarios")({
  component: ScenariosPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})

const MAX_STRUCTURE = 2000

function ScenariosPage() {
  const { current, isAdmin } = useBrand()
  const cache = useQueryClient()
  const brandId = current?.id ?? ""
  const [editing, setEditing] = useState<ScenarioPublic | "new" | null>(null)
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

  if (!current) return <EmptyState title={T.selectBrand} />
  const rows = list.data ?? []
  const own = rows.filter((r) => r.brand_id === brandId)
  const newest = (r: ScenarioPublic) =>
    !own.some(
      (o) =>
        o.scene === r.scene &&
        o.name === r.name &&
        o.template_version > r.template_version,
    )

  return (
    <div className="min-w-0 space-y-6">
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
      {list.isLoading && <Skeleton className="h-48 w-full" />}
      {list.isError && (
        <ErrorBanner error={parseApiError(list.error)} onRetry={list.refetch} />
      )}
      {toggle.isError && <ErrorBanner error={parseApiError(toggle.error)} />}
      {list.isSuccess && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.name}</TableHead>
                <TableHead>{T.scene}</TableHead>
                <TableHead>{T.version}</TableHead>
                <TableHead>{T.source}</TableHead>
                <TableHead>{T.status}</TableHead>
                {isAdmin && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const global = r.brand_id === null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-64 break-words font-medium">
                      {r.name}
                    </TableCell>
                    <TableCell>
                      {SCENE_LABEL[r.scene as keyof typeof SCENE_LABEL] ??
                        r.scene}
                    </TableCell>
                    <TableCell>v{r.template_version}</TableCell>
                    <TableCell>
                      {global ? (
                        <Pill tone="gray">{T.builtin}</Pill>
                      ) : r.source_pattern_id ? (
                        <Link
                          to="/viral-patterns/$id"
                          params={{ id: r.source_pattern_id }}
                          className="text-primary hover:underline"
                        >
                          {T.fromViral}
                          {r.source_pattern_title
                            ? `：${r.source_pattern_title}`
                            : ""}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <Pill tone="ok">{T.on}</Pill>
                      ) : (
                        <Pill tone="gray">
                          {newest(r) ? T.off : T.replaced}
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
                              onClick={() => setEditing(r)}
                            >
                              {T.newVersion}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={toggle.isPending}
                              onClick={() => toggle.mutate(r)}
                            >
                              {r.enabled ? T.turnOff : T.turnOn}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
              {own.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 6 : 5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    {T.empty}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <TemplateDialog
          brandId={brandId}
          from={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
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
  onSaved: () => void
}) {
  const [scene, setScene] = useState(from?.scene ?? "seeding")
  const [name, setName] = useState(from?.name ?? "")
  const [structure, setStructure] = useState(from?.structure ?? "")
  const save = useMutation({
    mutationFn: async () =>
      (
        await ScenariosService.createBrandTemplate({
          path: { brand_id: brandId },
          body: { scene: scene as Scene, name, structure },
        })
      ).data,
    onSuccess: onSaved,
  })
  const valid = !!name.trim() && !!structure.trim()
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{from ? T.newVersion : T.add}</DialogTitle>
          <DialogDescription>
            {from ? `${from.name} v${from.template_version}` : T.description}
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
                readOnly={!!from}
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
                maxLength={MAX_STRUCTURE}
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {T.structureHint}（{structure.length} / {MAX_STRUCTURE}）
              </p>
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
              {T.save}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
