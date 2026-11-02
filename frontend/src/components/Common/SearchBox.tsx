import { Search, X } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

// 关键词搜索框：停止输入 300 毫秒后才把值交给列表，避免每敲一个字就请求一次。
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  // 外部清空筛选时，输入框也要跟着清空。
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft.trim() === value) return
    const timer = setTimeout(() => onChange(draft.trim()), 300)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])
  return (
    <div
      className={cn(
        "relative inline-flex h-10 w-64 max-w-full shrink-0 items-center rounded-lg bg-surface-low text-sm focus-within:ring-[3px] focus-within:ring-ring/30",
        className,
      )}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
      />
      <input
        type="search"
        aria-label={label ?? placeholder}
        className="h-full w-full bg-transparent pr-8 pl-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        maxLength={100}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {draft && (
        <button
          type="button"
          aria-label="清除搜索"
          className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDraft("")
            onChange("")
          }}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
