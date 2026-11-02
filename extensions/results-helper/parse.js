// Reads the like, collect and comment numbers that the open Xiaohongshu note page already shows.
// It touches nothing else on the page and makes no network request. The class names come from a
// desktop Chrome page (see docs/EXTENSION.md); when the page changes, parsing fails visibly and the
// person types the numbers instead.

const LABEL_ONLY = new Set(["赞", "点赞", "收藏", "评论"]) // the page shows a word instead of 0

// "2.1万" -> 21000 (approximate), "539" -> 539, "赞" -> 0. Anything else -> null.
function parseCount(text) {
  const t = (text || "").replace(/\s+/g, "")
  if (!t) return null
  if (LABEL_ONLY.has(t)) return { value: 0, approximate: false }
  if (/^\d+$/.test(t)) return { value: Number(t), approximate: false }
  const unit = t.match(/^(\d+(?:\.\d+)?)(万|w|W|亿)\+?$/)
  if (unit) {
    const factor = unit[2] === "亿" ? 100000000 : 10000
    return { value: Math.round(Number(unit[1]) * factor), approximate: true }
  }
  const plus = t.match(/^(\d+)\+$/)
  if (plus) return { value: Number(plus[1]), approximate: true }
  return null
}

function textOf(doc, selector) {
  const el = doc.querySelector(selector)
  return el ? el.textContent : null
}

// Every element that matches. A note opened as an overlay on the feed leaves the feed's own
// like counts in the page behind it, so "the first match" can belong to another note.
function allOf(doc, selector) {
  if (typeof doc.querySelectorAll === "function") return [...doc.querySelectorAll(selector)]
  const el = doc.querySelector(selector)
  return el ? [el] : []
}

// The element of this selector that belongs to the same note as `anchor`: climb from the anchor
// until the surrounding block holds exactly one match. Several matches in the smallest block that
// holds any means the page does not say which one is this note's, so there is no answer.
function scopedTo(anchor, selector) {
  for (let node = anchor; node; node = node.parentElement) {
    if (typeof node.querySelectorAll !== "function") return null
    const inside = node.querySelectorAll(selector)
    if (inside.length === 1) return inside[0]
    if (inside.length > 1) return null
  }
  return null
}

const SELECTORS = { likes: ".like-wrapper .count", collects: ".collect-wrapper .count", comments: ".chat-wrapper .count" }

// The three number elements of one note, or null for a name when the page does not say which is
// the note's. A feed card only shows a like count, so the collect and comment counts are the
// anchor and the like count is the one in the same block.
function locateCounts(doc) {
  const found = {}
  for (const name of Object.keys(SELECTORS)) found[name] = allOf(doc, SELECTORS[name])
  const anchor = [found.collects, found.comments].find((list) => list.length === 1)?.[0] ?? null
  const located = {}
  const ambiguous = []
  for (const name of Object.keys(SELECTORS)) {
    const list = found[name]
    if (list.length <= 1) located[name] = list[0] ?? null
    else if (anchor && (located[name] = scopedTo(anchor, SELECTORS[name]))) continue
    else {
      located[name] = null
      ambiguous.push(name)
    }
  }
  return { located, ambiguous }
}

// "共 1575 条评论" -> 1575
function parseCommentTotal(text) {
  const m = (text || "").match(/共\s*(\d+)\s*条评论/)
  return m ? Number(m[1]) : null
}

// Returns { ok, likes, collects, comments, approximate, commentsCheck, problems }.
// commentsCheck: "match" | "mismatch" | "unavailable" (the page shows no "共 N 条评论" text).
function parseNoteDocument(doc) {
  const problems = []
  const { located, ambiguous } = locateCounts(doc)
  const read = (key, name) => {
    if (ambiguous.includes(key)) {
      problems.push(`页面上有多处${name}（可能是别的笔记的），无法确定哪个属于当前笔记`)
      return null
    }
    const parsed = parseCount(located[key] ? located[key].textContent : null)
    if (!parsed) problems.push(`没有读到${name}`)
    return parsed
  }
  const likes = read("likes", "点赞数")
  const collects = read("collects", "收藏数")
  let comments = read("comments", "评论数")
  const total = parseCommentTotal(textOf(doc, ".total"))

  let commentsCheck = "unavailable"
  if (total !== null && ambiguous.length === 0) {
    if (comments && !comments.approximate) {
      commentsCheck = comments.value === total ? "match" : "mismatch"
      if (commentsCheck === "mismatch") {
        problems.push(`评论数不一致：按钮显示 ${comments.value}，评论区写共 ${total} 条`)
      }
    } else {
      // The button shows an abbreviation (or nothing); the exact total is better.
      comments = { value: total, approximate: false }
      commentsCheck = "match"
    }
  }

  const ok = Boolean(likes && collects && comments) && commentsCheck !== "mismatch"
  return {
    ok,
    likes: likes ? likes.value : null,
    collects: collects ? collects.value : null,
    comments: comments ? comments.value : null,
    approximate: [likes, collects, comments].some((c) => c && c.approximate),
    commentsCheck,
    problems,
  }
}

// Only a page of one note can be read: the home and search pages show other notes' numbers.
// Same shape the system accepts: /explore/<id>, /discovery/item/<id>, /search_result/<id>, /user/profile/<user>/<id>.
function isNotePath(pathname) {
  return /^\/(?:explore|discovery\/item|search_result|user\/profile\/[^/]+)\/[0-9a-f]{24}\/?$/.test(pathname || "")
}

// The address is the system's origin: https, or http only for this computer.
function normalizeServer(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    return null
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname)
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null
  return url.origin
}

// One pasted string carries both settings: "rnk1." + base64url(JSON {"s": address, "k": key}).
// The system's key page shows it next to the key, so the person pastes once instead of typing twice.
const CONNECTION_PREFIX = "rnk1."

function parseConnection(text) {
  const raw = String(text || "").trim()
  if (!raw.startsWith(CONNECTION_PREFIX)) return null
  let data
  try {
    const b64 = raw.slice(CONNECTION_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/")
    data = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))
  } catch {
    return null
  }
  if (!data || typeof data.s !== "string" || typeof data.k !== "string") return null
  const server = normalizeServer(data.s)
  const key = data.k.trim()
  if (!server || !key.startsWith("rnk_")) return null
  return { server, key }
}

if (typeof module !== "undefined") {
  module.exports = { parseCount, parseCommentTotal, parseNoteDocument, normalizeServer, parseConnection, isNotePath }
}
