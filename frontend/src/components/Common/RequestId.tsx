import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"

// Error request number with a copy button. Unknown numbers show a dash and no button.
export function RequestId({ id }: { id: string | null | undefined }) {
  const [, copy] = useCopyToClipboard()
  const [state, setState] = useState<"idle" | "done" | "failed">("idle")

  if (!id) {
    return <span className="text-xs text-muted-foreground">请求编号 —</span>
  }
  const onCopy = async () => {
    const ok = await copy(id)
    setState(ok ? "done" : "failed")
    setTimeout(() => setState("idle"), 2000)
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      请求编号
      <code className="rounded bg-surface px-1">{id}</code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-0.5 text-link hover:underline"
      >
        {state === "done" ? (
          <Check className="size-3" />
        ) : (
          <Copy className="size-3" />
        )}
        {state === "done" ? "已复制" : state === "failed" ? "复制失败" : "复制"}
      </button>
    </span>
  )
}
