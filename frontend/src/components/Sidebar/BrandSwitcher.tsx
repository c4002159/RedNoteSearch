import { Link } from "@tanstack/react-router"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { label, ROLE_LABEL } from "@/lib/zh"

// Brand chosen in the top bar. The list comes from GET /brands; switching only changes the target brand.
export function BrandSwitcher() {
  const { user } = useAuth()
  const { brands, current, isLoading, isError, refetch, select } = useBrand()

  if (isLoading) {
    return <Skeleton className="h-9 w-56" />
  }
  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        品牌列表加载失败
        <Button size="sm" variant="outline" onClick={refetch}>
          重试
        </Button>
      </div>
    )
  }
  if (!current) {
    return user?.is_superuser ? (
      <Button asChild size="sm" variant="outline">
        <Link to="/brands">未选择品牌 · 创建品牌</Link>
      </Button>
    ) : (
      <span className="text-sm text-muted-foreground">
        请联系品牌管理员把你加入品牌
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          className="h-9 max-w-80 justify-between gap-2 bg-surface-low"
          data-testid="brand-switcher"
        >
          <span className="size-4 shrink-0 rounded-sm bg-brand-swatch" />
          <span className="truncate">
            {current.name} · {label(ROLE_LABEL, current.role, "role")}
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>切换品牌</DropdownMenuLabel>
        {brands.map((b) => (
          <DropdownMenuItem key={b.id} onClick={() => select(b.id)}>
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            <span className="text-xs text-muted-foreground">
              {label(ROLE_LABEL, b.role, "role")}
            </span>
            {b.id === current.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/brands">品牌与切换</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
