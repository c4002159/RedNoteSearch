import { Link, useLocation } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import { TEMPLATE_ANALYSIS_TABS as T } from "@/lib/zh"

export function TemplateAnalysisTabs() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const viral =
    pathname.startsWith("/viral-samples") ||
    pathname.startsWith("/viral-patterns")
  return (
    <nav
      aria-label={T.label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-surface-low p-1 text-sm"
    >
      {(
        [
          { to: "/scenarios", title: T.templates, active: !viral },
          { to: "/viral-samples", title: T.viral, active: viral },
        ] as const
      ).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "rounded-lg px-4 py-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
            item.active
              ? "bg-card text-link shadow-sm"
              : "text-on-surface-variant hover:bg-card/60 hover:text-link",
          )}
        >
          {item.title}
        </Link>
      ))}
    </nav>
  )
}
