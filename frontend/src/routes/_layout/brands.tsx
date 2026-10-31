import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { type BrandCategory, BrandsService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { BRAND_CATEGORY_LABEL, label, ROLE_LABEL } from "@/lib/zh"

export const Route = createFileRoute("/_layout/brands")({
  component: BrandsPage,
  head: () => ({ meta: [{ title: "品牌与切换 - RedNoteSearch" }] }),
})

function CreateBrand({ onDone }: { onDone: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<BrandCategory>("perfume")
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await BrandsService.createBrand({
          body: { name: name.trim(), category },
        })
      ).data,
    onSuccess: async (brand) => {
      toast.success("品牌已创建")
      await queryClient.invalidateQueries({ queryKey: ["brands"] })
      setName("")
      onDone(brand.id)
    },
  })

  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) mutation.mutate()
      }}
    >
      <h2 className="text-base font-semibold">创建品牌</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is nested in the label */}
        <label className="space-y-1 text-sm">
          <span>品牌名称</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span>品类</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as BrandCategory)}
          >
            {(Object.keys(BRAND_CATEGORY_LABEL) as BrandCategory[]).map((k) => (
              <option key={k} value={k}>
                {label(BRAND_CATEGORY_LABEL, k, "brand_category")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mutation.isError && (
        <ErrorBanner error={parseApiError(mutation.error)} />
      )}
      <LoadingButton type="submit" loading={mutation.isPending}>
        创建品牌
      </LoadingButton>
    </form>
  )
}

function BrandsPage() {
  const { user } = useAuth()
  const { brands, current, isLoading, isError, refetch, select } = useBrand()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">品牌与切换</h1>
        <p className="text-sm text-muted-foreground">
          选择当前要操作的品牌。你在每个品牌里的角色决定可以使用哪些功能。
        </p>
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {isError && (
        <ErrorBanner
          error={{
            status: 0,
            code: "UNKNOWN",
            message: "品牌列表加载失败",
            details: {},
            requestId: null,
          }}
          onRetry={refetch}
        />
      )}
      {!isLoading && !isError && brands.length === 0 && (
        <EmptyState
          title="你还没有加入任何品牌"
          description={
            user?.is_superuser
              ? "可以在下方创建第一个品牌。"
              : "请联系品牌管理员把你加入品牌。"
          }
        />
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {brands.map((b) => {
          const active = b.id === current?.id
          return (
            <li
              key={b.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-4"
            >
              <span className="size-4 shrink-0 rounded-sm bg-brand-swatch" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">
                  {label(BRAND_CATEGORY_LABEL, b.category, "brand_category")} ·{" "}
                  {label(ROLE_LABEL, b.role, "role")}
                </p>
              </div>
              {active ? (
                <span className="flex items-center gap-1 text-sm text-primary">
                  <Check className="size-4" /> 当前品牌
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => select(b.id)}
                >
                  切换
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {user?.is_superuser && <CreateBrand onDone={select} />}
    </div>
  )
}
