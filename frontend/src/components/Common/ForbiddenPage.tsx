import { Link } from "@tanstack/react-router"
import { Lock, SearchX } from "lucide-react"

import { RequestId } from "@/components/Common/RequestId"
import { Button } from "@/components/ui/button"

// 403: not allowed (shows the way back, never logs out). 404: missing or not visible (no hint which).
export function ForbiddenPage({ requestId }: { requestId?: string | null }) {
  return (
    <div className="mx-auto my-16 flex max-w-2xl flex-col items-center gap-6 rounded-xl bg-card px-8 py-12 text-center shadow-sm">
      <div className="rounded-full bg-surface-low p-4">
        <Lock className="size-8 text-primary" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">
        没有权限查看这个页面
      </h2>
      <p className="text-sm text-muted-foreground">
        你不是该品牌的成员，或当前角色不能访问。
      </p>
      {requestId && (
        <div className="w-full rounded-lg bg-surface-low p-4">
          <RequestId id={requestId} />
        </div>
      )}
      <Button asChild>
        <Link to="/brands">返回品牌与切换</Link>
      </Button>
    </div>
  )
}

export function MissingPage({ requestId }: { requestId?: string | null }) {
  return (
    <div className="mx-auto my-16 flex max-w-xl flex-col items-center gap-5 px-8 py-12 text-center">
      <div className="relative flex h-24 items-center justify-center">
        <span
          aria-hidden="true"
          className="text-8xl font-bold tracking-widest text-surface"
        >
          404
        </span>
        <SearchX className="absolute size-10 rounded-lg bg-card p-2 text-primary shadow-sm" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">
        没有找到这个内容
      </h2>
      <p className="text-sm text-muted-foreground">
        不区分“不存在”和“没有权限”。
      </p>
      <Button asChild>
        <Link to="/tasks">返回</Link>
      </Button>
      <RequestId id={requestId} />
    </div>
  )
}
