import { cn } from "@/lib/utils"

export type FilterOption = { value: string; label: string }

// 标签在左、下拉在右的筛选胶囊，用在表格之外的筛选（如“状态：全部”）。
export function FilterSelect({
  title,
  value,
  onChange,
  options,
  className,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  className?: string
}) {
  return (
    <label
      className={cn(
        "inline-flex h-10 items-center gap-1 rounded-lg bg-surface-low pl-3 text-sm focus-within:ring-[3px] focus-within:ring-ring/30",
        className,
      )}
    >
      <span className="whitespace-nowrap text-muted-foreground">{title}：</span>
      <select
        aria-label={title}
        className="h-10 cursor-pointer rounded-lg border-0 bg-transparent pr-2 text-sm font-medium outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// 放进表头里的筛选：没选时显示列名，选了之后显示选中项并变成蓝色。
export function HeaderFilter({
  title,
  value,
  onChange,
  options,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
}) {
  return (
    <select
      aria-label={`按${title}筛选`}
      className={cn(
        "-ml-2 h-8 max-w-full cursor-pointer rounded-md border-0 bg-transparent py-0 pr-1 pl-2 text-[13px] font-bold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
        value ? "text-link" : "text-on-surface-variant",
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{title}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
