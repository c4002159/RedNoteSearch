import { expect, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

for (const width of [1280, 720]) {
  test(`offline login favicon loads without template request at ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const requests: string[] = []
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("request", (event) => requests.push(new URL(event.url()).pathname))
    await page.goto("/login")
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible()
    const icon = page.locator('link[rel="icon"]')
    await expect(icon).toHaveCount(1)
    await expect(icon).toHaveAttribute("href", "/assets/images/favicon.png")
    const response = await request.get("/assets/images/favicon.png")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("image/png")
    await page.reload()
    await expect(page).toHaveTitle("登录 - RedNoteSearch")
    expect(requests).not.toContain("/vite.svg")
    expect(errors).toEqual([])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false)
  })
}
