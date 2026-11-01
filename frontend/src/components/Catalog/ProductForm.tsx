import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { z } from "zod"
import { type ProductPublic, ProductsService } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
import { CharCounter } from "@/components/Common/CharCounter"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { codePointCount } from "@/lib/count"
import { BRAND_CATEGORY_LABEL, CATALOG_TEXT as T } from "@/lib/zh"
import { ListField } from "./Fields"
import { SourcePicker, SourceReference } from "./Sources"

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, T.nameRequired)
    .refine((v) => codePointCount(v) <= 100, T.nameLimit),
  product_line: z.string().refine((v) => codePointCount(v) <= 100, T.nameLimit),
  category: z.enum([
    "perfume",
    "skincare",
    "makeup",
    "home_fragrance",
    "other",
  ]),
  notes: z.object({
    top: z.array(z.string()),
    middle: z.array(z.string()),
    base: z.array(z.string()),
  }),
  selling_points: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1, T.pointRequired)
          .refine((v) => codePointCount(v) <= 300, T.pointLimit),
        source_document_id: z.string().nullable(),
        source_chunk_id: z.string().nullable(),
      }),
    )
    .max(30, T.tooMany),
  restricted_claims: z.array(z.string()).max(50, T.tooMany),
})
export function ProductForm({
  brandId,
  product,
  onClose,
  onSaved,
}: {
  brandId: string
  product?: ProductPublic
  onClose: () => void
  onSaved: () => void
}) {
  const [source, setSource] = useState<number | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? "",
      product_line: product?.product_line ?? "",
      category: (product?.category ?? "other") as z.infer<
        typeof schema
      >["category"],
      notes: {
        top: product?.notes.top ?? [],
        middle: product?.notes.middle ?? [],
        base: product?.notes.base ?? [],
      },
      selling_points:
        product?.selling_points.map((p) => ({
          text: p.text,
          source_document_id: p.source_document_id ?? null,
          source_chunk_id: p.source_chunk_id ?? null,
        })) ?? [],
      restricted_claims: product?.restricted_claims ?? [],
    },
  })
  const points = useFieldArray({
    control: form.control,
    name: "selling_points",
  })
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      product
        ? ProductsService.updateProduct({
            path: { product_id: product.id },
            body: v,
          })
        : ProductsService.createProduct({
            path: { brand_id: brandId },
            body: v,
          }),
    onSuccess: onSaved,
  })
  return (
    <Sheet open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <SheetContent
        className="w-full overflow-y-auto p-5 sm:max-w-2xl"
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <SheetHeader className="p-0">
          <SheetTitle>{product ? T.editProduct : T.newProduct}</SheetTitle>
          <SheetDescription>{T.productHint}</SheetDescription>
        </SheetHeader>
        <form
          className="space-y-5"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset className="space-y-4" disabled={mutation.isPending}>
            <legend className="sr-only">{T.products}</legend>
            <div>
              <label htmlFor="product-name">{T.name}</label>
              <Input id="product-name" {...form.register("name")} />
              <p className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <div>
              <label htmlFor="product-line">{T.line}</label>
              <Input id="product-line" {...form.register("product_line")} />
              <p className="text-xs text-destructive">
                {form.formState.errors.product_line?.message}
              </p>
            </div>
            <div>
              <label htmlFor="product-category">{T.category}</label>
              <select
                id="product-category"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                {...form.register("category")}
              >
                {Object.entries(BRAND_CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {(["top", "middle", "base"] as const).map((k) => (
              <Controller
                key={k}
                name={`notes.${k}`}
                control={form.control}
                render={({ field }) => (
                  <ListField
                    id={`notes-${k}`}
                    title={T[k]}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            ))}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{T.points}</h3>
                <CharCounter value={points.fields.length} limit={30} />
              </div>
              {points.fields.map((p, i) => {
                const value = form.watch(`selling_points.${i}`)
                return (
                  <div key={p.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex justify-between gap-2">
                      <Pill tone={value.source_document_id ? "info" : "gray"}>
                        {value.source_document_id ? T.linked : T.draft}
                      </Pill>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => points.remove(i)}
                      >
                        {T.remove}
                      </Button>
                    </div>
                    <label htmlFor={`point-${i}`}>
                      {T.point} {i + 1}
                    </label>
                    <Textarea
                      id={`point-${i}`}
                      {...form.register(`selling_points.${i}.text`)}
                    />
                    <div className="flex justify-between gap-2">
                      <p className="text-xs text-destructive">
                        {
                          form.formState.errors.selling_points?.[i]?.text
                            ?.message
                        }
                      </p>
                      <CharCounter
                        value={codePointCount(value.text)}
                        limit={300}
                      />
                    </div>
                    <SourceReference point={value} admin />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSource(i)}
                      >
                        {T.source}
                      </Button>
                      {value.source_document_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            form.setValue(
                              `selling_points.${i}.source_document_id`,
                              null,
                            )
                            form.setValue(
                              `selling_points.${i}.source_chunk_id`,
                              null,
                            )
                          }}
                        >
                          {T.clearSource}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                disabled={points.fields.length >= 30}
                onClick={() =>
                  points.append({
                    text: "",
                    source_document_id: null,
                    source_chunk_id: null,
                  })
                }
              >
                {T.add} {T.points}
              </Button>
              <p className="text-xs text-destructive">
                {form.formState.errors.selling_points?.root?.message}
              </p>
            </div>
            <Controller
              name="restricted_claims"
              control={form.control}
              render={({ field }) => (
                <ListField
                  id="restricted-claims"
                  title={T.restricted}
                  value={field.value}
                  onChange={field.onChange}
                  limit={50}
                />
              )}
            />
            <p className="text-xs text-muted-foreground">{T.restrictedHint}</p>
          </fieldset>
          {mutation.isError && <BrandError error={mutation.error} />}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton type="submit" loading={mutation.isPending}>
              {T.save}
            </LoadingButton>
          </div>
        </form>
        {source !== null && (
          <SourcePicker
            brandId={brandId}
            onClose={() => setSource(null)}
            onSelect={(doc, chunk) => {
              form.setValue(
                `selling_points.${source}.source_document_id`,
                doc,
                { shouldDirty: true },
              )
              form.setValue(`selling_points.${source}.source_chunk_id`, chunk, {
                shouldDirty: true,
              })
              setSource(null)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
