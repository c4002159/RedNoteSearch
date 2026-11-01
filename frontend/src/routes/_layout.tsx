import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { Logo } from "@/components/Common/Logo"
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
        <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-border/40 bg-card px-4 shadow-header md:px-8">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <Logo />
          <div className="mx-1 h-4 w-px bg-border" />
          <BrandSwitcher />
          <div className="ml-auto">
            <User />
          </div>
        </header>
        <AppSidebar />
        <SidebarInset className="pt-16">
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
