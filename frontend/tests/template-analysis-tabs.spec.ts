import { expect, test } from "@playwright/test"
import { analysisIds, mockAnalysis } from "./utils/analysisVisual"

test.use({ storageState: { cookies: [], origins: [] } })

test("Sidebar moves analysis directly after templates and both tabs navigate with active state", async ({
  page,
}) => {
  await mockAnalysis(page)
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route("**/api/v1/scenarios", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.setViewportSize({ width: 1433, height: 900 })
  await page.goto("/scenarios")
  const sidebar = page.locator('[data-slot="sidebar-content"]')
  await expect(
    sidebar.getByRole("link", { name: "场景模板", exact: true }),
  ).toBeVisible()
  const links = await sidebar.getByRole("link").allTextContents()
  const templateIndex = links.findIndex((text) => text.includes("场景模板"))
  expect(templateIndex).toBeGreaterThanOrEqual(0)
  expect(links[templateIndex + 1]).toContain("爆款结构分析")
  await expect(sidebar.getByText("增强", { exact: true })).toHaveCount(0)
  const tabs = page.getByRole("navigation", {
    name: "模板与爆款分析",
    exact: true,
  })
  await expect(
    tabs.getByRole("link", { name: "场景模板", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await page.screenshot({ path: test.info().outputPath("template-tabs.png") })
  await tabs.getByRole("link", { name: "爆款分析", exact: true }).click()
  await expect(page).toHaveURL("/viral-samples")
  await expect(
    tabs.getByRole("link", { name: "爆款分析", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  for (const url of [
    `/viral-samples/${analysisIds.sample}`,
    `/viral-patterns/${analysisIds.pattern}`,
  ]) {
    await page.goto(url)
    await expect(
      tabs.getByRole("link", { name: "爆款分析", exact: true }),
    ).toHaveAttribute("aria-current", "page")
  }
  await tabs.getByRole("link", { name: "场景模板", exact: true }).click()
  await expect(page).toHaveURL("/scenarios")
})

test("Editors have the same two areas without extra permission requests", async ({
  page,
}) => {
  await mockAnalysis(page, true)
  await page.route("**/api/v1/brands/*/scenario-templates", (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.goto("/scenarios")
  const tabs = page.getByRole("navigation", {
    name: "模板与爆款分析",
    exact: true,
  })
  await expect(tabs.getByRole("link")).toHaveCount(2)
  await tabs.getByRole("link", { name: "爆款分析", exact: true }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "爆款结构分析", exact: true }),
  ).toBeVisible()
})
