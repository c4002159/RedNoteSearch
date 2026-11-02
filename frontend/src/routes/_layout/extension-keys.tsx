import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { type ExtensionKeyPublic, ExtensionService } from "@/client"
import { client } from "@/client/client.gen"
import { BrandError } from "@/components/Brands/Feedback"
import { CatalogGuard } from "@/components/Catalog/Fields"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { LoadingState } from "@/components/Common/LoadingState"
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
import { EXTENSION_KEYS_TEXT as T } from "@/lib/zh"

export const Route = createFileRoute("/_layout/extension-keys")({
  component: () => (
    <CatalogGuard>
      <Access />
    </CatalogGuard>
  ),
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})

function Access() {
  const brand = useBrand()
  return brand.isAdmin ? (
    <KeysPage key={brand.current!.id} brandId={brand.current!.id} />
  ) : (
    <ForbiddenPage />
  )
}

const schema = z.object({
  label: z
    .string()
    .trim()
    .min(1, T.nameError)
    .refine((v) => Array.from(v).length <= 60, T.nameError),
})

function CreateKey({
  brandId,
  onClose,
  refresh,
}: {
  brandId: string
  onClose: () => void
  refresh: () => void
}) {
  const [secret, setSecret] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { label: "" },
  })
  // Keep the one-time response out of Query's mutation cache and persistent storage.
  const close = () => {
    setSecret(null)
    onClose()
  }
  const config = secret
    ? `rnk1.${btoa(
        Array.from(
          new TextEncoder().encode(
            JSON.stringify({
              s: client.getConfig().baseURL || window.location.origin,
              k: secret,
            }),
          ),
          (byte) => String.fromCharCode(byte),
        ).join(""),
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`
    : ""
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(T.copied)
    } catch {
      toast.error(T.copyFailed)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && close()}>
      <DialogContent
        showCloseButton={!pending}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onInteractOutside={(e) => pending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{secret ? T.success : T.create}</DialogTitle>
          <DialogDescription>{secret ? T.once : T.nameHint}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="min-w-0 space-y-4">
            {[
              [T.key, secret, T.copyKey],
              [T.config, config, T.copyConfig],
            ].map(([title, value, copyLabel]) => (
              <div key={title} className="space-y-2">
                <label htmlFor={copyLabel}>{title}</label>
                <textarea
                  id={copyLabel}
                  readOnly
                  value={value}
                  className="w-full resize-none rounded-lg bg-surface-low p-3 font-mono text-sm [overflow-wrap:anywhere]"
                  rows={3}
                />
                <Button variant="outline" onClick={() => void copy(value)}>
                  {copyLabel}
                </Button>
              </div>
            ))}
            <DialogFooter>
              <Button onClick={close}>{T.close}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (body) => {
              setPending(true)
              setError(null)
              try {
                const result = await ExtensionService.createExtensionKey({
                  path: { brand_id: brandId },
                  body,
                })
                setSecret(result.data.key)
                refresh()
              } catch (cause) {
                setError(cause)
              } finally {
                setPending(false)
              }
            })}
          >
            <label htmlFor="key-label">{T.label}</label>
            <Input
              id="key-label"
              disabled={pending}
              {...form.register("label")}
            />
            <p className="text-sm text-destructive">
              {form.formState.errors.label?.message}
            </p>
            {!!error && (
              <BrandError
                error={error}
                message={
                  parseApiError(error).status === 422 ? T.limit : undefined
                }
              />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={close}
              >
                {T.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {T.create}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function KeysPage({ brandId }: { brandId: string }) {
  const cache = useQueryClient()
  const queryKey = ["extension-keys", brandId]
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await ExtensionService.readExtensionKeys({
        path: { brand_id: brandId },
        signal,
      })
      // Explicitly retain public fields only, even if a malformed response includes a key.
      return result.data.items.map(
        ({ id, label, prefix, created_at, last_used_at, revoked_at }) => ({
          id,
          label,
          prefix,
          created_at,
          last_used_at,
          revoked_at,
        }),
      )
    },
  })
  const [creating, setCreating] = useState(false)
  const [target, setTarget] = useState<ExtensionKeyPublic | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const refresh = () => {
    void cache.invalidateQueries({ queryKey })
  }
  if (query.isError && parseApiError(query.error).status === 403)
    return <ForbiddenPage requestId={parseApiError(query.error).requestId} />
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{T.description}</p>
        </div>
        <Button onClick={() => setCreating(true)}>{T.create}</Button>
      </header>
      <details className="rounded-xl bg-card p-5 shadow-sm">
        <summary className="cursor-pointer font-medium">
          {T.instructions}
        </summary>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
          {T.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      {query.isLoading && <LoadingState className="h-40 w-full" />}
      {query.isError && (
        <BrandError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.isSuccess && (
        <section className="min-w-0 rounded-xl bg-card p-6 shadow-sm">
          {query.data.length === 0 ? (
            <div className="py-12 text-center">
              <EmptyState title={T.empty} description={T.description} />
              <Button className="mt-4" onClick={() => setCreating(true)}>
                {T.first}
              </Button>
            </div>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  {[
                    T.label,
                    T.prefix,
                    T.created,
                    T.used,
                    T.status,
                    T.actions,
                  ].map((title) => (
                    <TableHead key={title}>{title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((row) => (
                  <TableRow
                    key={row.id}
                    className={
                      row.revoked_at
                        ? "bg-surface-low text-muted-foreground opacity-60"
                        : ""
                    }
                  >
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      {row.label}
                    </TableCell>
                    <TableCell className="whitespace-normal font-mono [overflow-wrap:anywhere]">
                      {row.prefix}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {formatTime(row.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {row.last_used_at
                        ? formatTime(row.last_used_at)
                        : T.never}
                    </TableCell>
                    <TableCell>
                      {row.revoked_at ? T.revoked : T.active}
                    </TableCell>
                    <TableCell>
                      {!row.revoked_at && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setError(null)
                            setTarget(row)
                          }}
                        >
                          {T.revoke}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
      {creating && (
        <CreateKey
          brandId={brandId}
          refresh={refresh}
          onClose={() => setCreating(false)}
        />
      )}
      {target && (
        <Dialog
          open
          onOpenChange={(open) => !open && !pending && setTarget(null)}
        >
          <DialogContent
            showCloseButton={!pending}
            onEscapeKeyDown={(e) => pending && e.preventDefault()}
            onInteractOutside={(e) => pending && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>{T.revokeTitle}</DialogTitle>
              <DialogDescription>{T.revokeHint}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-surface-low p-4 [overflow-wrap:anywhere]">
              <dt>{T.label}</dt>
              <dd className="text-right">{target.label}</dd>
              <dt>{T.prefix}</dt>
              <dd className="text-right font-mono">{target.prefix}</dd>
            </dl>
            {!!error && <BrandError error={error} />}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setTarget(null)}
              >
                {T.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={async () => {
                  setPending(true)
                  setError(null)
                  try {
                    await ExtensionService.revokeExtensionKey({
                      path: { brand_id: brandId, key_id: target.id },
                    })
                    setTarget(null)
                    refresh()
                  } catch (cause) {
                    setError(cause)
                  } finally {
                    setPending(false)
                  }
                }}
              >
                {T.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
