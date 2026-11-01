import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

test("Admin page is accessible and shows correct title", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect(page.getByText("管理用户账号与权限")).toBeVisible()
})

test("Add User button is visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("button", { name: "新增用户" })).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()
    const fullName = "Test User Admin"

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("邮箱").fill(email)
    await page.getByPlaceholder("姓名").fill(fullName)
    await page.getByPlaceholder("密码").first().fill(password)
    await page.getByPlaceholder("密码").last().fill(password)

    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户已创建")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow).toBeVisible()
  })

  test("Create a superuser", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("邮箱").fill(email)
    await page.getByPlaceholder("密码").first().fill(password)
    await page.getByPlaceholder("密码").last().fill(password)
    await page.getByLabel("平台管理员").check()
    await page.getByLabel("账号启用").check()

    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户已创建")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow.getByText("平台管理员")).toBeVisible()
  })

  test("Edit a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()
    const originalName = "Original Name"
    const updatedName = "Updated Name"

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("邮箱").fill(email)
    await page.getByPlaceholder("姓名").fill(originalName)
    await page.getByPlaceholder("密码").first().fill(password)
    await page.getByPlaceholder("密码").last().fill(password)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户已创建")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "编辑用户" }).click()

    await page.getByPlaceholder("姓名").fill(updatedName)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户资料已更新")).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
  })

  test("Delete a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("邮箱").fill(email)
    await page.getByPlaceholder("密码").first().fill(password)
    await page.getByPlaceholder("密码").last().fill(password)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户已创建")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "删除用户" }).click()

    await page.getByRole("button", { name: "删除" }).click()

    await expect(page.getByText("用户已删除")).toBeVisible()

    await expect(
      page.getByRole("row").filter({ hasText: email }),
    ).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("邮箱").fill("test@example.com")

    await page.getByRole("button", { name: "取消" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("Email is required and must be valid", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("邮箱").fill("invalid-email")
    await page.getByPlaceholder("邮箱").blur()

    await expect(page.getByText("请输入有效邮箱")).toBeVisible()
  })

  test("密码至少为 8 位", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("邮箱").fill(randomEmail())
    await page.getByPlaceholder("密码").first().fill("short")
    await page.getByPlaceholder("密码").last().fill("short")
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("密码至少为 8 位")).toBeVisible()
  })

  test("Passwords must match", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("邮箱").fill(randomEmail())
    await page.getByPlaceholder("密码").first().fill(randomPassword())
    await page.getByPlaceholder("密码").last().fill("different12345")
    await page.getByPlaceholder("密码").last().blur()

    await expect(page.getByText("两次输入的密码不一致")).toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "用户管理" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)

    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  })
})
