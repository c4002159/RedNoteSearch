// Run: node --test extensions/results-helper/test
const test = require("node:test")
const assert = require("node:assert/strict")
const { parseCount, parseCommentTotal, parseNoteDocument, normalizeServer, parseConnection, isNotePath } = require("../parse.js")

// A page with only the elements the parser asks for: selector -> text.
const page = (map) => ({
  querySelector: (selector) => (selector in map ? { textContent: map[selector] } : null),
})
const FULL = {
  ".like-wrapper .count": "2.1万",
  ".collect-wrapper .count": "539",
  ".chat-wrapper .count": "1575",
  ".total": "共 1575 条评论",
}

test("counts: plain, abbreviated and label-only", () => {
  assert.deepEqual(parseCount("539"), { value: 539, approximate: false })
  assert.deepEqual(parseCount(" 1 575 "), { value: 1575, approximate: false })
  assert.deepEqual(parseCount("2.1万"), { value: 21000, approximate: true })
  assert.deepEqual(parseCount("1.8w"), { value: 18000, approximate: true })
  assert.deepEqual(parseCount("10万+"), { value: 100000, approximate: true })
  assert.deepEqual(parseCount("1.2亿"), { value: 120000000, approximate: true })
  assert.deepEqual(parseCount("999+"), { value: 999, approximate: true })
  assert.deepEqual(parseCount("赞"), { value: 0, approximate: false })
  assert.deepEqual(parseCount("评论"), { value: 0, approximate: false })
  for (const bad of ["", null, undefined, "abc", "-3", "1.5", "万", "1e3", "1,575"]) {
    assert.equal(parseCount(bad), null, String(bad))
  }
})

test("comment total", () => {
  assert.equal(parseCommentTotal("共 1575 条评论"), 1575)
  assert.equal(parseCommentTotal("共1575条评论"), 1575)
  assert.equal(parseCommentTotal("暂无评论"), null)
  assert.equal(parseCommentTotal(null), null)
})

test("the page from the desktop sample: abbreviation marks the reading approximate", () => {
  const r = parseNoteDocument(page(FULL))
  assert.deepEqual(
    [r.ok, r.likes, r.collects, r.comments, r.approximate, r.commentsCheck, r.problems],
    [true, 21000, 539, 1575, true, "match", []],
  )
})

test("exact numbers are not marked approximate", () => {
  const r = parseNoteDocument(page({ ...FULL, ".like-wrapper .count": "9876" }))
  assert.equal(r.approximate, false)
  assert.equal(r.likes, 9876)
})

test("the exact comment total replaces an abbreviated comment count", () => {
  const r = parseNoteDocument(page({ ...FULL, ".chat-wrapper .count": "1.6万", ".total": "共 15870 条评论" }))
  assert.equal(r.comments, 15870)
  assert.equal(r.commentsCheck, "match")
  assert.equal(r.approximate, true) // the likes are still abbreviated
})

test("a comment count that disagrees with the total is not accepted", () => {
  const r = parseNoteDocument(page({ ...FULL, ".chat-wrapper .count": "1500" }))
  assert.equal(r.ok, false)
  assert.equal(r.commentsCheck, "mismatch")
  assert.equal(r.problems.length, 1)
})

test("without the total the comment count is used but flagged unchecked", () => {
  const { ".total": _omit, ...withoutTotal } = FULL
  const r = parseNoteDocument(page(withoutTotal))
  assert.equal(r.ok, true)
  assert.equal(r.commentsCheck, "unavailable")
})

test("missing elements fail visibly instead of guessing", () => {
  const r = parseNoteDocument(page({}))
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, ["没有读到点赞数", "没有读到收藏数", "没有读到评论数"])
  assert.deepEqual([r.likes, r.collects, r.comments], [null, null, null])
  const partial = parseNoteDocument(page({ ".like-wrapper .count": "10" }))
  assert.equal(partial.ok, false)
  assert.equal(partial.likes, 10)
})

// A small element tree: node(selector, text, children). querySelectorAll walks the descendants.
const node = (selector, text, children = []) => {
  const el = { selector, textContent: text, parentElement: null, children }
  children.forEach((c) => (c.parentElement = el))
  const descendants = () => children.flatMap((c) => [c, ...c.descendants()])
  el.descendants = descendants
  el.querySelectorAll = (sel) => descendants().filter((d) => d.selector === sel)
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] ?? null
  return el
}
const SEL = { l: ".like-wrapper .count", c: ".collect-wrapper .count", m: ".chat-wrapper .count" }
const feedCard = (likes) => node("card", "", [node(SEL.l, likes)])
const overlay = (likes, collects, comments) =>
  node("overlay", "", [node(SEL.l, likes), node(SEL.c, collects), node(SEL.m, comments), node(".total", `共 ${comments} 条评论`)])

test("a note opened over the feed: the like count is the overlay's, not the feed card before it", () => {
  const root = node("root", "", [feedCard("803"), feedCard("12"), overlay("810", "16", "40")])
  const r = parseNoteDocument(root)
  assert.deepEqual([r.ok, r.likes, r.collects, r.comments], [true, 810, 16, 40])
  assert.deepEqual(r.problems, [])
})

test("the feed card after the overlay in the page does not win either", () => {
  const root = node("root", "", [overlay("512", "10", "40"), feedCard("803")])
  const r = parseNoteDocument(root)
  assert.deepEqual([r.ok, r.likes, r.collects, r.comments], [true, 512, 10, 40])
})

test("a plain note page still reads as before", () => {
  const root = node("root", "", [overlay("889", "35", "45")])
  const r = parseNoteDocument(root)
  assert.deepEqual([r.ok, r.likes, r.collects, r.comments], [true, 889, 35, 45])
})

test("several notes with no way to tell which is open are not guessed", () => {
  const root = node("root", "", [overlay("512", "10", "40"), overlay("700", "20", "50")])
  const r = parseNoteDocument(root)
  assert.equal(r.ok, false)
  assert.deepEqual([r.likes, r.collects, r.comments], [null, null, null])
  assert.equal(r.problems.length, 3)
  assert.match(r.problems[0], /多处点赞数/)
})

test("zero shown as a word", () => {
  const r = parseNoteDocument(
    page({ ".like-wrapper .count": "赞", ".collect-wrapper .count": "收藏", ".chat-wrapper .count": "评论" }),
  )
  assert.equal(r.ok, true)
  assert.deepEqual([r.likes, r.collects, r.comments, r.approximate], [0, 0, 0, false])
})

const connection = (obj) =>
  "rnk1." + Buffer.from(JSON.stringify(obj)).toString("base64url")

test("server address: https, or http on this computer only", () => {
  assert.equal(normalizeServer("https://app.example.com/path?x=1"), "https://app.example.com")
  assert.equal(normalizeServer(" http://localhost:8011/ "), "http://localhost:8011")
  assert.equal(normalizeServer("http://127.0.0.1:8000"), "http://127.0.0.1:8000")
  for (const bad of ["http://app.example.com", "ftp://x", "localhost:8011", "", null]) {
    assert.equal(normalizeServer(bad), null, String(bad))
  }
})

test("connection string carries the address and the key", () => {
  const good = connection({ s: "https://app.example.com/anything", k: "rnk_abc123" })
  assert.deepEqual(parseConnection(` ${good}
`), { server: "https://app.example.com", key: "rnk_abc123" })
  assert.deepEqual(parseConnection(connection({ s: "http://localhost:8011", k: "rnk_x" })), {
    server: "http://localhost:8011",
    key: "rnk_x",
  })
})

test("a bad connection string is refused, never half-applied", () => {
  const bad = [
    "",
    null,
    "rnk_abc123",
    "rnk1.",
    "rnk1.%%%",
    "rnk1." + Buffer.from("not json").toString("base64url"),
    connection({ s: "https://app.example.com" }),
    connection({ k: "rnk_abc" }),
    connection({ s: "http://app.example.com", k: "rnk_abc" }),
    connection({ s: "https://app.example.com", k: "abc" }),
    connection({ s: 5, k: "rnk_abc" }),
    connection(null),
  ]
  for (const text of bad) assert.equal(parseConnection(text), null, String(text))
})

test("only the page of one note can be read", () => {
  const id = "65a1b2c3d4e5f60718293a4b"
  for (const ok of [`/explore/${id}`, `/explore/${id}/`, `/discovery/item/${id}`, `/search_result/${id}`, `/user/profile/5abc123/${id}`]) {
    assert.equal(isNotePath(ok), true, ok)
  }
  for (const bad of ["/", "/explore", "/explore/", "/search_result", "/user/profile/5abc123", `/explore/${id.slice(1)}`, `/explore/${id.toUpperCase()}`, `/explore/${id}/extra`, `/other/${id}`, "", null]) {
    assert.equal(isNotePath(bad), false, String(bad))
  }
})
