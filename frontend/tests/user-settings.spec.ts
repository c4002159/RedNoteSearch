import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi.ts"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser, logOutUser } from "./utils/user"

test("My profile tab is active by default", async ({ page }) => {
  await page.goto("/settings")
  await expect(
    page.getByRole("tab", { name: "我的资料", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await expect(
    page.getByRole("button", { name: "保存资料", exact: true }),
  ).toBeDisabled()
})
test("Only supported settings tabs and actions are visible", async ({
  page,
}) => {
  await page.goto("/settings")
  for (const name of ["我的资料", "修改密码"])
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("tab")).toHaveCount(2)
  await expect(page.getByRole("tab", { name: "Danger zone" })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /Delete Account|删除账号/ }),
  ).toHaveCount(0)
})
test.describe("Edit user profile", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string, password: string
  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
  })
  test.beforeEach(async ({ page }) => {
    await logInUser(page, email, password)
    await page.goto("/settings")
  })
  test("Edit user name with a valid name", async ({ page }) => {
    const name = "Test User 2"
    await page.getByLabel("姓名", { exact: true }).fill(name)
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/users/me") && r.request().method() === "PATCH",
    )
    await page.getByRole("button", { name: "保存资料", exact: true }).click()
    expect((await response).request().postDataJSON()).toEqual({
      full_name: name,
    })
    await expect(
      page.getByText("个人资料已保存", { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("姓名", { exact: true })).toHaveValue(name)
    await expect(
      page.getByRole("button", { name: "保存资料", exact: true }),
    ).toBeDisabled()
  })
  test("Email is readonly and explains administrator ownership", async ({
    page,
  }) => {
    await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email)
    await expect(page.getByLabel("邮箱", { exact: true })).not.toBeEditable()
    await expect(
      page.getByText("邮箱由管理员录入，不可直接修改", { exact: true }),
    ).toBeVisible()
  })
  test("Email remains readonly after saving a different name and reloading", async ({
    page,
  }) => {
    await page
      .getByLabel("姓名", { exact: true })
      .fill("Read-only email fixture")
    await page.getByRole("button", { name: "保存资料", exact: true }).click()
    await expect(
      page.getByText("个人资料已保存", { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email)
    await expect(page.getByLabel("邮箱", { exact: true })).not.toBeEditable()
  })
  test("Cancel edit action restores original name and email", async ({
    page,
  }) => {
    const field = page.getByLabel("姓名", { exact: true }),
      original = await field.inputValue()
    await field.fill("Changed without saving")
    await page.getByRole("button", { name: "取消修改", exact: true }).click()
    await expect(field).toHaveValue(original)
    await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email)
    await expect(
      page.getByRole("button", { name: "保存资料", exact: true }),
    ).toBeDisabled()
  })
  test("Name longer than 255 code points is rejected without PATCH", async ({
    page,
  }) => {
    let patches = 0
    page.on("request", (r) => {
      if (r.url().endsWith("/users/me") && r.method() === "PATCH") patches++
    })
    await page.getByLabel("姓名", { exact: true }).fill("甲".repeat(256))
    await page.getByRole("button", { name: "保存资料", exact: true }).click()
    await expect(
      page.getByText("姓名最多 255 字", { exact: true }),
    ).toBeVisible()
    expect(patches).toBe(0)
  })
})
test.describe("Change password", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test("Update password successfully and sign in with the new password", async ({
    page,
  }) => {
    const email = randomEmail(),
      password = randomPassword(),
      newPassword = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "修改密码", exact: true }).click()
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(newPassword)
    await page.getByTestId("confirm-password-input").fill(newPassword)
    await page.getByRole("button", { name: "修改密码", exact: true }).click()
    await expect(page.getByText("密码已更新", { exact: true })).toBeVisible()
    await logOutUser(page)
    await logInUser(page, email, newPassword)
  })
  test("Eight numeric characters and 128-character passwords both work", async ({
    page,
  }) => {
    const email = randomEmail()
    let password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)
    for (const next of ["12345678", "9".repeat(128)]) {
      await page.goto("/settings")
      await page.getByRole("tab", { name: "修改密码", exact: true }).click()
      await page.getByTestId("current-password-input").fill(password)
      await page.getByTestId("new-password-input").fill(next)
      await page.getByTestId("confirm-password-input").fill(next)
      await page.getByRole("button", { name: "修改密码", exact: true }).click()
      await expect(page.getByText("密码已更新", { exact: true })).toBeVisible()
      password = next
      await logOutUser(page)
      await logInUser(page, email, password)
    }
  })
})
test.describe("Change password validation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string, password: string
  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
  })
  test.beforeEach(async ({ page }) => {
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "修改密码", exact: true }).click()
  })
  test("Passwords shorter than 8 or longer than 128 are rejected", async ({
    page,
  }) => {
    for (const next of ["weak", "甲".repeat(129)]) {
      await page.getByTestId("current-password-input").fill(password)
      await page.getByTestId("new-password-input").fill(next)
      await page.getByTestId("confirm-password-input").fill(next)
      await page.getByRole("button", { name: "修改密码", exact: true }).click()
      await expect(
        page.getByText("密码须为 8 到 128 位", { exact: true }),
      ).toBeVisible()
    }
  })
  test("New password and confirmation do not match", async ({ page }) => {
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(randomPassword())
    await page.getByTestId("confirm-password-input").fill(randomPassword())
    await page.getByRole("button", { name: "修改密码", exact: true }).click()
    await expect(
      page.getByText("两次输入的新密码不一致", { exact: true }),
    ).toBeVisible()
  })
  test("Current password and new password cannot be the same", async ({
    page,
  }) => {
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(password)
    await page.getByTestId("confirm-password-input").fill(password)
    await page.getByRole("button", { name: "修改密码", exact: true }).click()
    await expect(
      page.getByText("新密码不能与当前密码相同", { exact: true }),
    ).toBeVisible()
  })
  test("Wrong current password returns 400 with request id without logout", async ({
    page,
  }) => {
    const next = randomPassword()
    await page.getByTestId("current-password-input").fill(randomPassword())
    await page.getByTestId("new-password-input").fill(next)
    await page.getByTestId("confirm-password-input").fill(next)
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/users/me/password") &&
        r.request().method() === "PATCH",
    )
    await page.getByRole("button", { name: "修改密码", exact: true }).click()
    expect((await response).status()).toBe(400)
    await expect(page.getByRole("alert")).toContainText("当前密码不正确")
    await expect(page.getByRole("alert").locator("code")).not.toHaveText("")
    await expect(page).toHaveURL(/\/settings$/)
  })
})

test("Appearance button is visible in sidebar", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByTestId("theme-button")).toBeVisible()
})

test("User can switch between theme modes", async ({ page }) => {
  await page.goto("/settings")

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)

  await expect(page.getByTestId("dark-mode")).not.toBeVisible()

  await page.getByTestId("theme-button").click()
  await page.getByTestId("light-mode").click()
  await expect(page.locator("html")).toHaveClass(/light/)
})

test("Selected mode is preserved across sessions", async ({ page }) => {
  await page.goto("/settings")

  await page.getByTestId("theme-button").click()
  if (
    await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    )
  ) {
    await page.getByTestId("light-mode").click()
    await page.getByTestId("theme-button").click()
  }

  const isLightMode = await page.evaluate(() =>
    document.documentElement.classList.contains("light"),
  )
  expect(isLightMode).toBe(true)

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  let isDarkMode = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  expect(isDarkMode).toBe(true)

  await logOutUser(page)
  await logInUser(page, firstSuperuser, firstSuperuserPassword)

  isDarkMode = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  expect(isDarkMode).toBe(true)
})
