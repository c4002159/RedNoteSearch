import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

// Text wordmark (no extra font or image files, so the demo also runs offline).
export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const full = (
    <span
      className={cn(
        "text-lg font-bold tracking-tight",
        variant === "responsive" && "group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      RedNote<span className="text-primary">Search</span>
    </span>
  )
  const icon = (
    <span
      className={cn(
        "flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground",
        variant === "responsive" && "hidden group-data-[collapsible=icon]:flex",
        className,
      )}
      aria-hidden="true"
    >
      R
    </span>
  )

  const content =
    variant === "full" ? (
      full
    ) : variant === "icon" ? (
      icon
    ) : (
      <>
        {full}
        {icon}
      </>
    )

  if (!asLink) {
    return content
  }
  return (
    <Link to="/" aria-label="RedNoteSearch">
      {content}
    </Link>
  )
}
