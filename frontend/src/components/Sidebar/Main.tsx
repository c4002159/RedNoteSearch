import { useQuery } from "@tanstack/react-query"
import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import { KnowledgeService } from "@/client"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useBrand } from "@/hooks/useBrand"
import type { NavGroup } from "./nav"

export function Main({ groups }: { groups: NavGroup[] }) {
  const { current } = useBrand()
  const pending = useQuery({
    queryKey: ["knowledge-pending", current?.id],
    enabled: current?.role === "admin",
    retry: false,
    queryFn: async () => {
      if (current?.role !== "admin") return 0
      return (
        await KnowledgeService.readDocuments({
          path: { brand_id: current.id },
          query: { status: "pending_review", page: 1, page_size: 1 },
        })
      ).data.total
    },
  })
  const { isMobile, setOpenMobile } = useSidebar()
  const currentPath = useRouterState().location.pathname

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.title}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const isActive =
                  currentPath === item.path ||
                  currentPath.startsWith(`${item.path}/`)
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={isActive}
                      asChild
                    >
                      <RouterLink to={item.path} onClick={handleMenuClick}>
                        <item.icon />
                        <span>{item.title}</span>
                      </RouterLink>
                    </SidebarMenuButton>
                    {item.path === "/knowledge/review" &&
                      current?.role === "admin" &&
                      !pending.isError &&
                      typeof pending.data === "number" &&
                      pending.data > 0 && (
                        <SidebarMenuBadge
                          aria-label={`${item.title} ${pending.data}`}
                        >
                          {pending.data}
                        </SidebarMenuBadge>
                      )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
