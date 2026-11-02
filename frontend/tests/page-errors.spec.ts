import { expect, test } from "@playwright/test"

test("Brand and rule errors stay Chinese and preserve request ids", async ({
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

  await page.goto("/products")
  await page.getByRole("button", { name: "新增商品", exact: true }).click()
  await page.getByLabel("商品名称", { exact: true }).fill("失败恢复测试")
  await page.route("**/api/v1/brands/*/products", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Service temporarily unavailable",
          details: {},
          request_id: "audit-product-failure",
        },
      }),
    }),
  )
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .press("Enter")
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用")
  await expect(page.getByRole("alert")).toContainText("audit-product-failure")
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(
    "失败恢复测试",
  )
  await page.unrouteAll({ behavior: "ignoreErrors" })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .press("Enter")

  await page.goto("/compliance/rules")
  await page.getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "导入规则", exact: true }).click()
  await page.locator("#rules-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '[{"layer":"bad","rule_type":"bad","pattern":"test","severity":"bad"}]',
    ),
  })
  const rows = page.getByRole("region", { name: "逐行错误" })
  await expect(rows).toContainText("层级")
  await expect(rows).toContainText("严重度")
  await expect(rows).toContainText("字段值不符合要求")
  await expect(rows).not.toContainText("Input should")
  await expect(page.getByRole("alert").locator("code")).not.toBeEmpty()
})
