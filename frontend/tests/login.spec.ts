import { expect, type Page, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { randomPassword } from "./utils/random.ts"

test.use({ storageState: { cookies: [], origins: [] } })

test("Unknown page has a Chinese title and recovery link", async ({ page }) => {
  await page.goto("/not-a-real-page")
  await expect(page).toHaveTitle("页面未找到 - RedNoteSearch")
  await expect(page.getByTestId("not-found")).toContainText(
    "没有找到你访问的页面",
  )
  await page.getByRole("button", { name: "返回", exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})

const fillForm = async (page: Page, email: string, password: string) => {
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
}

const verifyInput = async (page: Page, testId: string) => {
  const input = page.getByTestId(testId)
  await expect(input).toBeVisible()
  await expect(input).toHaveText("")
  await expect(input).toBeEditable()
}

test("Inputs are visible, empty and editable", async ({ page }) => {
  await page.goto("/login")

  await verifyInput(page, "email-input")
  await verifyInput(page, "password-input")
})

test("Log In button is visible", async ({ page }) => {
  await page.goto("/login")

  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible()
})

test("Forgot Password link is visible", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByRole("link", { name: "忘记密码？" })).toBeVisible()
})

test("Log in with valid email and password ", async ({ page }) => {
  await page.goto("/login")

  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await page.waitForURL("/")

  await expect(page.getByText("欢迎回来，很高兴再次见到你！")).toBeVisible()
})

test("Log in with invalid email", async ({ page }) => {
  await page.goto("/login")

  await fillForm(page, "invalidemail", firstSuperuserPassword)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await expect(page.getByText("请输入有效邮箱")).toBeVisible()
})

test("Log in with invalid password", async ({ page }) => {
  const password = randomPassword()

  await page.goto("/login")
  await fillForm(page, firstSuperuser, password)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await expect(page.getByText("邮箱或密码不正确")).toBeVisible()
})

test("Successful log out", async ({ page }) => {
  await page.goto("/login")

  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await page.waitForURL("/")

  await expect(page.getByText("欢迎回来，很高兴再次见到你！")).toBeVisible()

  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await page.waitForURL("/login")
})

test("Logged-out user cannot access protected routes", async ({ page }) => {
  await page.goto("/login")

  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await page.waitForURL("/")

  await expect(page.getByText("欢迎回来，很高兴再次见到你！")).toBeVisible()

  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await page.waitForURL("/login")

  await page.goto("/settings")
  await page.waitForURL("/login")
})

test("Redirects to /login when token is wrong", async ({ page }) => {
  await page.goto("/settings")
  await page.evaluate(() => {
    localStorage.setItem("access_token", "invalid_token")
  })
  await page.goto("/settings")
  await page.waitForURL("/login")
  await expect(page).toHaveURL("/login")
})

for (const status of [400, 401]) {
  test(`Login ${status} stays on the form and displays request id`, async ({
    page,
  }) => {
    await page.route("**/api/v1/login/access-token", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "LOGIN_ERROR",
            message: "arbitrary server wording",
            details: {},
            request_id: `ui-login-${status}`,
          },
        }),
      }),
    )
    await page.goto("/login")
    await fillForm(page, "login-fixture@example.com", "synthetic-password")
    const documentOrigin = await page.evaluate(() => performance.timeOrigin)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确")
    await expect(page.getByRole("alert").locator("code")).toHaveText(
      `ui-login-${status}`,
    )
    await expect(page.getByTestId("email-input")).toHaveValue(
      "login-fixture@example.com",
    )
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      documentOrigin,
    )
  })
}

test("Login does not offer self registration", async ({ page }) => {
  await page.goto("/login")
  await expect(
    page.getByText("账号由平台管理员创建，不提供自助注册", { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: /Sign up|注册/ })).toHaveCount(0)
})

test("Fresh login uses light theme despite dark system preference and preserves dark choice", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/login")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator("html")).toHaveClass(/light/)
  await expect(page).toHaveTitle("登录 - RedNoteSearch")
  // Scope the assertion to AuthLayout, excluding the development-tools footer.
  await expect(page.locator("#root > div.grid footer")).toHaveCount(0)
  await expect(
    page.getByRole("link", { name: "GitHub", exact: true }),
  ).toHaveCount(0)
  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(await page.evaluate(() => localStorage.getItem("vite-ui-theme"))).toBe(
    "dark",
  )
})
