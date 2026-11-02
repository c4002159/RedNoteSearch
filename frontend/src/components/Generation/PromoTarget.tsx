import type { ActivityInfo, ProductPublic, TaskCreate } from "@/client"
import { ListField } from "@/components/Catalog/Fields"
import { CharCounter } from "@/components/Common/CharCounter"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { codePointCount } from "@/lib/count"
import { BRAND_CATEGORY_LABEL, label, PROMO_TARGET_TEXT as T } from "@/lib/zh"

export type PromoValue = {
  type: "product" | "multi_product" | "activity"
  productId: string
  extras: string[]
  activity: ActivityInfo
}
export const emptyPromo: PromoValue = {
  type: "product",
  productId: "",
  extras: [],
  activity: { name: "", detail: "", perks: [] },
}
export function validPromo(
  value: PromoValue,
  products: ProductPublic[],
): boolean {
  if (value.type === "activity")
    return (
      !!value.activity.name.trim() &&
      codePointCount(value.activity.name.trim()) <= 100 &&
      codePointCount(value.activity.detail ?? "") <= 1000 &&
      (value.activity.perks ?? []).length <= 10 &&
      (value.activity.perks ?? []).every(
        (p) => !!p.trim() && codePointCount(p) <= 200,
      )
    )
  const ids = new Set(products.map((p) => p.id))
  return (
    ids.has(value.productId) &&
    (value.type === "product" ||
      (value.extras.length >= 1 &&
        value.extras.length <= 4 &&
        new Set(value.extras).size === value.extras.length &&
        value.extras.every((id) => id !== value.productId && ids.has(id))))
  )
}
export function promoBody(
  value: PromoValue,
): Pick<
  TaskCreate,
  "promo_type" | "product_id" | "extra_product_ids" | "activity"
> {
  if (value.type === "activity")
    return {
      promo_type: "activity",
      activity: { ...value.activity, name: value.activity.name.trim() },
    }
  return {
    promo_type: value.type,
    product_id: value.productId,
    ...(value.type === "multi_product"
      ? { extra_product_ids: value.extras }
      : {}),
  }
}
export function PromoTarget({
  value,
  onChange,
  products,
}: {
  value: PromoValue
  onChange: (value: PromoValue) => void
  products: ProductPublic[]
}) {
  const selected = products.find((p) => p.id === value.productId)
  return (
    <section className="space-y-4 lg:mr-72">
      <h2 className="text-base font-semibold">{T.title}</h2>
      <div
        role="radiogroup"
        aria-label={T.title}
        className="grid grid-cols-3 gap-1 rounded-xl bg-surface-low p-1"
      >
        {Object.entries(T.types).map(([key, text]) => (
          <Button
            key={key}
            type="button"
            role="radio"
            aria-checked={value.type === key}
            variant="ghost"
            className={
              value.type === key
                ? "bg-card text-link shadow-sm"
                : "text-muted-foreground"
            }
            onClick={() =>
              onChange({ ...value, type: key as PromoValue["type"] })
            }
          >
            {text}
          </Button>
        ))}
      </div>
      {value.type === "activity" ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex justify-between">
              <label htmlFor="activity-name" className="text-sm">
                {T.activityName}
              </label>
              <CharCounter
                value={codePointCount(value.activity.name)}
                limit={100}
              />
            </div>
            <Input
              id="activity-name"
              value={value.activity.name}
              onChange={(e) =>
                onChange({
                  ...value,
                  activity: { ...value.activity, name: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <label htmlFor="activity-detail" className="text-sm">
                {T.detail}
              </label>
              <CharCounter
                value={codePointCount(value.activity.detail ?? "")}
                limit={1000}
              />
            </div>
            <Textarea
              id="activity-detail"
              value={value.activity.detail ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  activity: { ...value.activity, detail: e.target.value },
                })
              }
            />
          </div>
          <ListField
            id="activity-perks"
            title={T.perks}
            value={value.activity.perks ?? []}
            limit={10}
            onChange={(perks) =>
              onChange({ ...value, activity: { ...value.activity, perks } })
            }
          />
          <p className="text-xs text-muted-foreground">{T.perksLimit}</p>
          <p className="rounded-lg bg-tone-warn-bg p-3 text-xs leading-6 text-tone-warn">
            {T.activityHint}
          </p>
        </div>
      ) : (
        <>
          <Select
            value={value.productId}
            onValueChange={(id) =>
              onChange({
                ...value,
                productId: id,
                extras: value.extras.filter((extra) => extra !== id),
              })
            }
          >
            <SelectTrigger
              aria-label={
                value.type === "multi_product" ? T.primary : T.product
              }
              className="w-full bg-surface-low"
            >
              <SelectValue placeholder={T.choose} />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <p className="rounded-lg bg-surface-low px-3 py-2 text-xs text-on-surface-variant">
              {T.category}
              {label(BRAND_CATEGORY_LABEL, selected.category)}
              {selected.product_line
                ? ` · ${T.line}${selected.product_line}`
                : ""}
            </p>
          )}
          {value.type === "multi_product" && (
            <details className="rounded-xl bg-surface-low p-3">
              <summary className="cursor-pointer text-sm text-link">
                {T.extras(value.extras.length)}
              </summary>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {products.map((p) => (
                  <label
                    key={p.id}
                    htmlFor={`extra-${p.id}`}
                    className="flex items-center gap-3 rounded-lg bg-card p-3 text-sm"
                  >
                    <Checkbox
                      id={`extra-${p.id}`}
                      aria-label={p.name}
                      checked={value.extras.includes(p.id)}
                      disabled={
                        p.id === value.productId ||
                        (value.extras.length >= 4 &&
                          !value.extras.includes(p.id))
                      }
                      onCheckedChange={(checked) =>
                        onChange({
                          ...value,
                          extras:
                            checked === true
                              ? [...value.extras, p.id]
                              : value.extras.filter((id) => id !== p.id),
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.product_line ||
                          label(BRAND_CATEGORY_LABEL, p.category)}
                      </span>
                    </span>
                    {p.id === value.productId && (
                      <span className="text-xs text-tone-warn">
                        {T.isPrimary}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                onClick={() => onChange({ ...value, extras: [] })}
              >
                {T.clear}
              </Button>
            </details>
          )}
          {!products.length && (
            <p className="text-sm text-muted-foreground">{T.noProducts}</p>
          )}
        </>
      )}
    </section>
  )
}
