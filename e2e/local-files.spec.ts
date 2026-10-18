import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, openCanvas, test } from './fixtures.ts'

function makeFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'canvas-e2e-'))
  const folder = join(root, 'Projects')
  mkdirSync(join(folder, 'finance'), { recursive: true })
  mkdirSync(join(folder, '.git'))
  writeFileSync(join(folder, 'finance', 'budget-real-2026.txt'), 'real budget numbers: 42')
  writeFileSync(join(folder, 'invoice-acme.html'), '<script>window.opener && (window.opener.__pwned = 1)</script>')
  writeFileSync(join(folder, '.git', 'config'), 'hidden')
  return folder
}

test.describe('connected folders (real files)', () => {
  test('indexes a folder, searches it and opens a real file in a new tab', async ({ page, context, violations }) => {
    const commandBar = await openCanvas(page)
    await page.getByLabel('Connect folder').setInputFiles(makeFolder())
    await expect(page.getByRole('status', { name: 'Files' })).toHaveText('Projects · 2 files')

    await commandBar.fill('find budget')
    const surface = page.getByRole('region', { name: 'File search' })
    await expect(surface.getByRole('button', { name: 'budget-real-2026.txt' })).toBeVisible()
    await expect(surface.getByText('budget-2026.xlsx')).toHaveCount(0) // demo files are gone

    const [tab] = await Promise.all([context.waitForEvent('page'), surface.getByRole('button', { name: 'budget-real-2026.txt' }).click()])
    await tab.waitForLoadState()
    expect(tab.url()).toMatch(/^blob:/)
    await expect(tab.locator('body')).toContainText('real budget numbers: 42')
    await expect(surface).toHaveCount(0)
    expect(violations).toEqual([])
  })

  test('downloads files that could run script instead of opening them', async ({ page }) => {
    const commandBar = await openCanvas(page)
    await page.getByLabel('Connect folder').setInputFiles(makeFolder())
    await expect(page.getByRole('status', { name: 'Files' })).toHaveText('Projects · 2 files')

    await commandBar.fill('find invoice')
    const surface = page.getByRole('region', { name: 'File search' })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      surface.getByRole('button', { name: 'invoice-acme.html' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('invoice-acme.html')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  })
})
