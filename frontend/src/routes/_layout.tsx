import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import { BrandSwitcher } from "@/components/Sidebar/BrandSwitcher"
import { User } from "@/components/Sidebar/User"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { BrandProvider } from "@/hooks/useBrand"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

// Below 1280px the sidebar starts collapsed to the icon bar (design: app shell at 1024).
const startsOpen = () =>
  typeof window === "undefined" ? true : window.innerWidth >= 1280

function Layout() {
  return (
    <BrandProvider>
      <SidebarProvider defaultOpen={startsOpen()}>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-card px-4 shadow-header">
            <SidebarTrigger className="-ml-1 text-muted-foreground" />
            <BrandSwitcher />
            <div className="ml-auto">
              <User />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-8">
            <div className="mx-auto max-w-7xl">
              <Outlet />
            </div>
          </main>
          <Footer />
        </SidebarInset>
      </SidebarProvider>
    </BrandProvider>
  )
}
