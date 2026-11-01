import { Link } from "@tanstack/react-router"
import { SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SHELL_AUDIT_TEXT, SHELL_TEXT } from "@/lib/zh"

const NotFound = () => {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 py-16 text-center"
      data-testid="not-found"
    >
      <title>{SHELL_AUDIT_TEXT.notFoundTitle}</title>
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex items-center justify-center">
          <span className="text-8xl font-bold leading-none tracking-widest text-surface md:text-9xl">
            404
          </span>
          <SearchX className="absolute size-12 rounded-lg bg-card p-3 text-primary shadow-sm" />
        </div>
        <span className="text-2xl font-semibold tracking-tight">
          {SHELL_TEXT.notice}
        </span>
      </div>

      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {SHELL_TEXT.notFound}
      </p>
      <div>
        <Link to="/">
          <Button>{SHELL_TEXT.back}</Button>
        </Link>
      </div>
    </div>
  )
}

export default NotFound
