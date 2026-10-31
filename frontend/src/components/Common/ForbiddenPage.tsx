import { Link } from "@tanstack/react-router"
import { Lock, SearchX } from "lucide-react"

import { RequestId } from "@/components/Common/RequestId"
import { Button } from "@/components/ui/button"

// 403: not allowed (shows the way back, never logs out). 404: missing or not visible (no hint which).
export function ForbiddenPage({ requestId }: { requestId?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Lock className="size-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">没有权限查看这个页面</h2>
      <p className="text-sm text-muted-foreground">
        你不是该品牌的成员，或当前角色不能访问。
      </p>
      <Button asChild variant="outline">
        <Link to="/brands">返回品牌与切换</Link>
      </Button>
      <RequestId id={requestId} />
    </div>
  )
}

export function MissingPage({ requestId }: { requestId?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">没有找到这个内容</h2>
      <p className="text-sm text-muted-foreground">
        不区分“不存在”和“没有权限”。
      </p>
      <Button asChild variant="outline">
        <Link to="/tasks">返回</Link>
      </Button>
      <RequestId id={requestId} />
    </div>
  )
}
