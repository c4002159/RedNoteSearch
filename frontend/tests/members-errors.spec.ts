import { expect, test } from "@playwright/test"

test("Last brand administrator cannot be removed and sees a Chinese error", async ({
  page,
}) => {
  await page.goto("/brands")
  await page.getByRole("button", { name: "新建品牌", exact: true }).click()
  await page
    .getByLabel("品牌名称", { exact: true })
    .fill(`错误走查-${Date.now()}`)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "新建品牌", exact: true })
    .click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "移除成员", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click()
  await expect(page.getByRole("alert")).toContainText(
    "不能移除或降级最后一位品牌管理员",
  )
  await expect(page.getByRole("alert")).toContainText("请求编号")
  await expect(page.getByRole("alert").locator("code")).not.toBeEmpty()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click()
})
