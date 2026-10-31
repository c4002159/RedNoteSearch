// Length rules of docs/decisions/ADR-004 (same as the backend; the backend result is authoritative).

export const TITLE_LIMIT = 20
export const BODY_LIMIT = 1000
export const TAG_LIMIT = 10

// Title: one code point at a time, ASCII printable (U+0020 to U+007E) counts 0.5, everything else 1.
export function titleWeight(text: string): number {
  let total = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    total += code >= 0x20 && code <= 0x7e ? 0.5 : 1
  }
  return total
}

// Body: UTF-16 code units after removing line breaks (an emoji counts 2).
export function bodyUnits(text: string): number {
  return text.replace(/\n/g, "").length
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").trim()
}

// One tag costs "#" + name + one separating space in the body budget (conservative, ADR-004).
export function tagsVisibleUnits(tags: string[]): number {
  return tags.reduce((sum, t) => sum + 1 + normalizeTag(t).length + 1, 0)
}

export function formatWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
