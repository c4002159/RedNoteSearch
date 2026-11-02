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

// "共 1575 条评论" -> 1575
function parseCommentTotal(text) {
  const m = (text || "").match(/共\s*(\d+)\s*条评论/)
  return m ? Number(m[1]) : null
}

// Returns { ok, likes, collects, comments, approximate, commentsCheck, problems }.
// commentsCheck: "match" | "mismatch" | "unavailable" (the page shows no "共 N 条评论" text).
function parseNoteDocument(doc) {
  const problems = []
  const read = (selector, name) => {
    const parsed = parseCount(textOf(doc, selector))
    if (!parsed) problems.push(`没有读到${name}`)
    return parsed
  }
  const likes = read(".like-wrapper .count", "点赞数")
  const collects = read(".collect-wrapper .count", "收藏数")
  let comments = read(".chat-wrapper .count", "评论数")
  const total = parseCommentTotal(textOf(doc, ".total"))

  let commentsCheck = "unavailable"
  if (total !== null) {
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

if (typeof module !== "undefined") {
  module.exports = { parseCount, parseCommentTotal, parseNoteDocument }
}
