import { useQuery } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

import { type BrandListItem, BrandsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"

const STORAGE_KEY = "current_brand_id"

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

type BrandContextValue = {
  brands: BrandListItem[]
  current: BrandListItem | null
  isAdmin: boolean
  isLoading: boolean
  isError: boolean
  refetch: () => void
  select: (id: string) => void
}

const BrandContext = createContext<BrandContextValue | null>(null)

// The brand comes from GET /brands; the id is only a target, never an authorization (FC-09).
export function BrandProvider({ children }: { children: ReactNode }) {
  const [storedId, setStoredId] = useState<string | null>(readStored)
  const query = useQuery({
    queryKey: ["brands"],
    queryFn: async () => (await BrandsService.readBrands()).data.items,
    enabled: isLoggedIn(),
  })

  const brands = useMemo(() => query.data ?? [], [query.data])
  const current = useMemo(
    () => brands.find((b) => b.id === storedId) ?? brands[0] ?? null,
    [brands, storedId],
  )

  const select = useCallback((id: string) => {
    setStoredId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Private windows may refuse storage; the choice then lasts for this page only.
    }
  }, [])

  const value: BrandContextValue = {
    brands,
    current,
    isAdmin: current?.role === "admin",
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch()
    },
    select,
  }
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandContextValue {
  const value = useContext(BrandContext)
  if (!value) throw new Error("useBrand must be used inside BrandProvider")
  return value
}
