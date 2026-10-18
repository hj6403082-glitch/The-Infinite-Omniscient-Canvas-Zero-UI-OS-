import { test as base, expect, type Page } from '@playwright/test'

// Collects CSP / Trusted Types violations and page errors for every test.
export const test = base.extend<{ violations: string[] }>({
  violations: async ({ page }, use) => {
    const violations: string[] = []
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const log = ((window as unknown as { __violations?: string[] }).__violations ??= [])
        log.push(`${event.violatedDirective}: ${event.blockedURI}`)
      })
    })
    page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (/Content Security Policy|Trusted Type/i.test(message.text())) violations.push(message.text())
    })
    await use(violations)
    const inPage = await page
      .evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? [])
      .catch(() => [])
    violations.push(...inPage)
  },
})

export { expect }

export async function openCanvas(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Accelerator' })).toHaveText(/WebNN · NPU|WebGPU · GPU|WASM · CPU/, {
    timeout: 45_000,
  })
  return page.getByRole('searchbox', { name: 'Command bar' })
}
