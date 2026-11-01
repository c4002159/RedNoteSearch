import { createFileRoute } from "@tanstack/react-router"
import useAuth from "@/hooks/useAuth"
import { SHELL_TEXT } from "@/lib/zh"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: SHELL_TEXT.dashboardTitle,
      },
    ],
  }),
})

function Dashboard() {
  const { user: currentUser } = useAuth()

  return (
    <div>
      <div>
        <h1 className="text-2xl truncate max-w-sm">
          {SHELL_TEXT.hello} {currentUser?.full_name || currentUser?.email} 👋
        </h1>
        <p className="text-muted-foreground">{SHELL_TEXT.welcome}</p>
      </div>
    </div>
  )
}
