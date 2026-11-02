import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type FilterOption = { value: string; label: string }

// Radix Select 不允许空字符串作为选项值，空值用这个占位。
const NONE = "__none"
const toKey = (v: string) => (v === "" ? NONE : v)
const fromKey = (v: string) => (v === NONE ? "" : v)

// 弹出层与表头同色，不用浏览器自带的白色列表。
const MENU = "min-w-36 border-0 bg-surface-low shadow-lg"

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
    <Select value={toKey(value)} onValueChange={(v) => onChange(fromKey(v))}>
      <SelectTrigger
        aria-label={title}
        className={cn(
          "h-10 gap-2 border-0 bg-surface-low px-3 text-sm hover:bg-surface",
          className,
        )}
      >
        <span className="text-muted-foreground">{title}：</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={MENU}>
        {options.map((o) => (
          <SelectItem key={o.value} value={toKey(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// 放进表头里的筛选：没选时显示列名，选了之后显示选中项并变成蓝色。
// 背景透明，与表头同色；showAll 为 false 时不加“全部”（用于排序）。
export function HeaderFilter({
  title,
  value,
  onChange,
  options,
  showAll = true,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  showAll?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <Select value={toKey(value)} onValueChange={(v) => onChange(fromKey(v))}>
      <SelectTrigger
        aria-label={`按${title}筛选`}
        className={cn(
          "-ml-2 h-8 w-auto min-w-fit gap-1 border-0 bg-transparent px-2 py-0 text-[13px] font-bold shadow-none hover:bg-surface focus-visible:ring-2",
          value ? "text-link" : "text-on-surface-variant",
        )}
      >
        <SelectValue>
          <span className="whitespace-nowrap">
            {value && selected ? selected.label : title}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={MENU} align="start">
        {showAll && <SelectItem value={NONE}>全部</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={toKey(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
