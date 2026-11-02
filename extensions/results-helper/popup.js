// Popup logic: read the numbers from the open note page, let the person check them, send them.
// Nothing is sent without a click on "发送到系统"; the only server it talks to is the one the person entered.

const $ = (id) => document.getElementById(id)
const NOTE_HOSTS = ["xiaohongshu.com"]

function show(kind, text) {
  const box = $("status")
  box.className = `status ${kind}`
  box.textContent = text
  box.hidden = false
}

function normalizeServer(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname)
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null
  return url.origin
}

async function activeNoteTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.url) return null
  const host = new URL(tab.url).hostname
  return NOTE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? tab : null
}

// Only the path of the page is sent: the address can carry tokens in its query.
function notePageUrl(tabUrl) {
  const url = new URL(tabUrl)
  return url.origin + url.pathname
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(["server", "key"])
  $("server").value = saved.server || ""
  $("key").value = saved.key || ""
  if (!saved.server || !saved.key) $("settings").open = true
}

$("save").addEventListener("click", async () => {
  const origin = normalizeServer($("server").value)
  const key = $("key").value.trim()
  if (!origin) return show("error", "系统地址需要是 https 地址（本机测试可用 http://localhost）。")
  if (!key.startsWith("rnk_")) return show("error", "插件密钥应以 rnk_ 开头。")
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) return show("error", "没有授权访问这个系统地址，无法发送。")
  await chrome.storage.local.set({ server: origin, key })
  show("ok", "已保存。")
})

$("read").addEventListener("click", async () => {
  const tab = await activeNoteTab()
  if (!tab) return show("warn", "请先在小红书笔记页打开本插件。")
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parse.js"] })
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => parseNoteDocument(document),
    })
    $("result").hidden = false
    $("likes").value = result.likes ?? ""
    $("collects").value = result.collects ?? ""
    $("comments").value = result.comments ?? ""
    $("approximate").checked = result.approximate
    const notes = [...result.problems]
    if (result.commentsCheck === "match") notes.push("评论数与评论区的总数一致。")
    if (result.commentsCheck === "unavailable") notes.push("评论区总数未出现，评论数没有交叉核对。")
    if (!result.ok) notes.push("读取不完整或不一致，请对照页面手动填写后再发送。")
    show(result.ok ? "ok" : "warn", notes.join("\n"))
  } catch {
    show("error", "读取失败。页面可能还没加载完，或页面结构变了，请手动填写。")
    $("result").hidden = false
  }
})

$("send").addEventListener("click", async () => {
  const { server, key } = await chrome.storage.local.get(["server", "key"])
  if (!server || !key) {
    $("settings").open = true
    return show("error", "请先在“连接设置”里填写系统地址和密钥。")
  }
  const tab = await activeNoteTab()
  if (!tab) return show("warn", "请在小红书笔记页发送。")
  const numbers = ["likes", "collects", "comments"].map((id) => Number($(id).value))
  if (numbers.some((n) => !Number.isInteger(n) || n < 0)) {
    return show("error", "点赞、收藏、评论都需要是不小于 0 的整数。")
  }
  $("send").disabled = true
  try {
    const response = await fetch(`${server}/api/v1/extension/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Extension-Key": key },
      body: JSON.stringify({
        note_url: notePageUrl(tab.url),
        likes: numbers[0],
        collects: numbers[1],
        comments: numbers[2],
        approximate: $("approximate").checked,
        captured_at: new Date().toISOString(),
      }),
    })
    if (response.status === 201) return show("ok", "已记录。")
    if (response.status === 401) return show("error", "密钥无效或已作废，请重新生成。")
    if (response.status === 404) {
      return show("error", "系统里没有保存这篇笔记的网址。请先在“已确认文案”里填入这篇笔记的帖子网址。")
    }
    if (response.status === 429) return show("warn", "这篇笔记一小时内记录得太多了，稍后再试。")
    show("error", `发送失败（${response.status}）。`)
  } catch {
    show("error", "连不上系统，请检查系统地址和网络。")
  } finally {
    $("send").disabled = false
  }
})

loadSettings()
