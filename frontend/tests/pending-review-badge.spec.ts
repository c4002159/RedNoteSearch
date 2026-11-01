import { expect, test } from "@playwright/test"

const brandId = "11111111-1111-4111-8111-111111111111"

for (const scenario of [
  { role: "admin", total: 3, status: 200, badge: true },
  { role: "admin", total: 0, status: 200, badge: false },
  { role: "admin", total: 3, status: 500, badge: false },
  { role: "editor", total: 3, status: 403, badge: false },
]) {
  test(`${scenario.role} pending ${scenario.total}, response ${scenario.status}`, async ({
    page,
  }) => {
    let requests = 0
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.context().clearCookies()
    await page.route("**/api/v1/brands", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: brandId,
              name: "徽标回归品牌",
              category: "perfume",
              role: scenario.role,
            },
          ],
        },
      }),
    )
    await page.route("**/api/v1/brands/*/members", (route) =>
      route.fulfill({ json: { items: [] } }),
    )
    await page.route("**/api/v1/brands/*/knowledge-documents?*", (route) => {
      requests++
      const url = new URL(route.request().url())
      expect(url.searchParams.get("status")).toBe("pending_review")
      expect(url.searchParams.get("page_size")).toBe("1")
      return route.fulfill({
        status: scenario.status,
        json:
          scenario.status === 200
            ? { items: [], total: scenario.total, page: 1, page_size: 1 }
            : {
                error: {
                  code: "INTERNAL_ERROR",
                  message: "Injected error",
                  details: {},
                  request_id: "badge-probe",
                },
              },
      })
    })
    await page.goto("/brands")
    await expect(page.getByText("徽标回归品牌", { exact: true })).toBeVisible()
    const badge = page.locator('[data-slot="sidebar-menu-badge"]')
    if (scenario.badge) {
      await expect(badge).toHaveText("3")
      await expect(page.getByLabel("待审队列 3", { exact: true })).toBeVisible()
    } else {
      if (scenario.role === "admin") await expect.poll(() => requests).toBe(1)
      await expect(badge).toHaveCount(0)
    }
    await page.waitForTimeout(250)
    expect(requests).toBe(scenario.role === "admin" ? 1 : 0)
    if (scenario.role === "editor")
      await expect(
        page.getByRole("link", { name: "待审队列", exact: true }),
      ).toHaveCount(0)
    await expect(page.getByRole("alert")).toHaveCount(0)
  })
}
