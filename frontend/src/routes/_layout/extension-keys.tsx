import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/extension-keys")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings",
      search: { tab: "plugin" },
      replace: true,
    })
  },
})
