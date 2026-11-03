import { expect, type Page } from "@playwright/test"

// Existing content-level tests explicitly open the new default-collapsed controls.
export async function revealChangeControls(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: /第 \d+ 版/ }),
  ).toBeVisible()
  const list = page.getByRole("region", { name: "修改清单", exact: true })
  if (await list.count()) {
    const details = list.locator("details").first()
    if (
      !(await details.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    )
      await details.locator(":scope > summary").click()
    const note = list.getByText("补充说明（可选）", { exact: true })
    await note.click()
    await expect(page.getByLabel("补充说明", { exact: true })).toBeVisible()
  }
}
export async function showAllEvidence(page: Page) {
  await page.getByRole("button", { name: "全部", exact: true }).click()
  const closed = page.locator(
    '[data-review-state="done"] > details:not([open]) > summary',
  )
  while (await closed.count()) await closed.first().click()
}
