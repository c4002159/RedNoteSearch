import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { BrandsService } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
import { Members } from "@/components/Brands/Members"
import { EmptyState } from "@/components/Common/EmptyState"
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
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { codePointCount } from "@/lib/count"
import {
  BRAND_CATEGORY_LABEL,
  label,
  ROLE_LABEL,
  BRAND_PAGE_TEXT as T,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/brands")({
  component: BrandsPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, T.nameRequired)
    .refine((v) => codePointCount(v) <= 100, T.nameLimit),
  category: z.enum([
    "perfume",
    "skincare",
    "makeup",
    "home_fragrance",
    "other",
  ]),
})
function CreateBrand({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (id: string) => void
}) {
  const cache = useQueryClient()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", category: "perfume" },
  })
  const mutation = useMutation({
    mutationFn: async (body: z.infer<typeof schema>) =>
      (await BrandsService.createBrand({ body })).data,
    onSuccess: async (b) => {
      toast.success(T.created)
      await cache.invalidateQueries({ queryKey: ["brands"] })
      onDone(b.id)
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.create}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset className="space-y-3" disabled={mutation.isPending}>
            <legend className="sr-only">{T.create}</legend>
            <div>
              <label htmlFor="brand-name">{T.name}</label>
              <Input id="brand-name" {...form.register("name")} />
              <p className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <div>
              <label htmlFor="brand-category">{T.category}</label>
              <select
                id="brand-category"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...form.register("category")}
              >
                {Object.entries(BRAND_CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          {mutation.isError && <BrandError error={mutation.error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton type="submit" loading={mutation.isPending}>
              {T.create}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function BrandsPage() {
  const { user } = useAuth(),
    brand = useBrand(),
    cache = useQueryClient()
  const [creating, setCreating] = useState(false)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        {user?.is_superuser && (
          <Button onClick={() => setCreating(true)}>{T.create}</Button>
        )}
      </div>
      {brand.isLoading && <Skeleton className="h-32 w-full" />}
      {brand.isError && (
        <BrandError
          error={cache.getQueryState(["brands"])?.error}
          retry={brand.refetch}
        />
      )}{" "}
      {!brand.isLoading && !brand.isError && brand.brands.length === 0 && (
        <EmptyState
          title={T.empty}
          description={user?.is_superuser ? T.createHint : T.emptyHint}
        />
      )}
      {!brand.isError && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <ul className="space-y-3">
            {brand.brands.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
              >
                <span className="size-4 shrink-0 rounded-sm bg-brand-swatch" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {label(BRAND_CATEGORY_LABEL, b.category, "brand_category")}{" "}
                    · {label(ROLE_LABEL, b.role, "role")}
                  </p>
                </div>
                {b.id === brand.current?.id ? (
                  <span className="flex items-center gap-1 text-sm text-primary">
                    <Check className="size-4" />
                    {T.current}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => brand.select(b.id)}
                  >
                    {T.switch}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {brand.current && (brand.isAdmin || user?.is_superuser) && (
            <Members key={brand.current.id} brandId={brand.current.id} />
          )}
        </div>
      )}
      {creating && user?.is_superuser && (
        <CreateBrand onClose={() => setCreating(false)} onDone={brand.select} />
      )}
    </div>
  )
}
