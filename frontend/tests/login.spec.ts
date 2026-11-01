import { expect, type Page, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { randomPassword } from "./utils/random.ts"

test.use({ storageState: { cookies: [], origins: [] } })

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

  await expect(
    page.getByText("Welcome back, nice to see you again!"),
  ).toBeVisible()
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

  await expect(
    page.getByText("Welcome back, nice to see you again!"),
  ).toBeVisible()

  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await page.waitForURL("/login")
})

test("Logged-out user cannot access protected routes", async ({ page }) => {
  await page.goto("/login")

  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "登录", exact: true }).click()

  await page.waitForURL("/")

  await expect(
    page.getByText("Welcome back, nice to see you again!"),
  ).toBeVisible()

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
