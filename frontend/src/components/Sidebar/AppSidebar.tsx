import { SidebarAppearance } from "@/components/Common/Appearance"
import { Sidebar, SidebarContent, SidebarFooter } from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { Main } from "./Main"
import { visibleGroups } from "./nav"

export function AppSidebar() {
  const { user } = useAuth()
  const { current } = useBrand()

  // Navigation only hides what the role cannot use; the server still decides (FC-08).
  const groups = visibleGroups({
    isMember: current !== null,
    isAdmin: current?.role === "admin",
    isPlatform: !!user?.is_superuser,
  })

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <Main groups={groups} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
