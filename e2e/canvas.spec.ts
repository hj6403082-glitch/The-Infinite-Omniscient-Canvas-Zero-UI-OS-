import { expect, openCanvas, test } from './fixtures.ts'

test.describe('Infinite Canvas (production build, strict CSP + Trusted Types)', () => {
  test('boots the on-device model with no security policy violations', async ({ page, violations }) => {
    await openCanvas(page)
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("require-trusted-types-for 'script'")
    expect(csp).not.toContain('unsafe-inline')
    expect(violations).toEqual([])
  })

  test('search intent hydrates a DataTable and a terminal action destroys it', async ({ page, violations }) => {
    const commandBar = await openCanvas(page)
    await commandBar.fill('find my invoices')

    const surface = page.getByRole('region', { name: 'File search' })
    await expect(surface).toBeVisible()
    await expect(page.getByRole('status', { name: 'Last intent' })).toHaveText(/File search · \d+%/)
    const openButtons = surface.getByRole('button', { name: /^invoice-2026-\d\d\.pdf$/ })
    await expect(openButtons).toHaveCount(3)

    await surface.getByRole('button', { name: 'invoice-2026-09.pdf' }).click()
    await expect(surface).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Tensor ledger' })).toHaveText(/(\d+) created · \1 deleted · 0 live/)
    expect(violations).toEqual([])
  })

  test('status intent shows the accelerator and Dismiss frees the canvas', async ({ page, violations }) => {
    const commandBar = await openCanvas(page)
    await commandBar.fill('system status')
    const surface = page.getByRole('region', { name: 'System status' })
    await expect(surface).toBeVisible()
    await expect(surface).toContainText(/Accelerator: (WebNN|WebGPU|WebAssembly)/)

    await page.getByRole('button', { name: 'Dismiss System status' }).click()
    await expect(surface).toHaveCount(0)
    await expect(page.getByText(/Start typing/)).toBeVisible()
    await expect(page.getByRole('status', { name: 'Tensor ledger' })).toHaveText(/(\d+) created · \1 deleted · 0 live/)
    expect(violations).toEqual([])
  })

  test('a refined query supersedes the open surface instead of stacking', async ({ page }) => {
    const commandBar = await openCanvas(page)
    await commandBar.fill('find invoices')
    await expect(page.getByRole('region', { name: 'File search' })).toBeVisible()
    await commandBar.fill('find tax pdf')
    await expect(page.getByRole('region', { name: 'File search' }).getByText('tax-return-2025.pdf')).toBeVisible()
    await expect(page.getByRole('region', { name: 'File search' })).toHaveCount(1)
  })

  test('non-intents leave the canvas empty', async ({ page }) => {
    const commandBar = await openCanvas(page)
    await commandBar.fill('hello there')
    await page.waitForTimeout(1500)
    await expect(page.getByRole('region')).toHaveCount(0)
  })
})
