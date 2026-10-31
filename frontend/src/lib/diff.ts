export type DiffRow = {
  left: string | null
  right: string | null
  same: boolean
}

// Line-by-line comparison by longest common subsequence; used to compare two versions of a text.
export function diffLines(a: string[], b: string[]): DiffRow[] {
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ left: a[i], right: b[j], same: true })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ left: a[i++], right: null, same: false })
    } else {
      rows.push({ left: null, right: b[j++], same: false })
    }
  }
  while (i < n) rows.push({ left: a[i++], right: null, same: false })
  while (j < m) rows.push({ left: null, right: b[j++], same: false })
  return rows
}
