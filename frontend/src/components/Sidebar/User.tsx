import { Link as RouterLink } from "@tanstack/react-router"
import { LogOut, Settings } from "lucide-react"

import { Pill } from "@/components/Common/StatusBadge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { label, ROLE_LABEL } from "@/lib/zh"
import { getInitials } from "@/utils"

// User menu in the top bar: name, email, role in the current brand, settings, sign out.
export function User() {
  const { user, logout } = useAuth()
  const { current } = useBrand()

  if (!user) return null
  const name = user.full_name || user.email

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="user-menu"
          className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent"
        >
          <span className="hidden flex-col items-end text-right sm:flex">
            <span className="text-sm font-medium leading-tight">{name}</span>
            <span className="text-xs leading-tight text-muted-foreground">
              {current ? label(ROLE_LABEL, current.role, "role") : "未选择品牌"}
            </span>
          </span>
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel className="space-y-1 font-normal">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {user.is_superuser && <Pill tone="softBlue">平台管理员</Pill>}
            {current && (
              <span className="text-xs text-muted-foreground">
                {current.name} · {label(ROLE_LABEL, current.role, "role")}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <RouterLink to="/settings">
            <Settings /> 用户设置
          </RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout}>
          <LogOut /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
