import { expect, openCanvas, test } from './fixtures.ts'

// F3: hydration must not stall the main thread (inference runs in the worker, A2UI messages
// are applied at most once per animation frame). Headless CI runs on shared vCPUs, so the
// assertion budget is looser than the 16.7 ms target; the measured p95 is reported.
test('main thread keeps rendering frames while surfaces stream in', async ({ page }, testInfo) => {
  const commandBar = await openCanvas(page)
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __longTasks: number[] }
    w.__frames = []
    w.__longTasks = []
    let last = performance.now()
    const tick = (now: number) => {
      w.__frames.push(now - last)
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: false })
  })

  for (const query of ['find invoices', 'system status', 'find tax pdf', 'open meeting notes']) {
    await commandBar.fill(query)
    await page.waitForTimeout(900)
  }

  const { frames, longTasks } = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __longTasks: number[] }
    return { frames: w.__frames.slice(1), longTasks: w.__longTasks }
  })
  const sorted = [...frames].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  testInfo.annotations.push({ type: 'frame-time p95 (ms)', description: p95.toFixed(1) })
  testInfo.annotations.push({ type: 'long tasks (ms)', description: JSON.stringify(longTasks.map(Math.round)) })
  console.log(`frames=${frames.length} p95=${p95.toFixed(1)}ms longTasks=${JSON.stringify(longTasks.map(Math.round))}`)

  expect(frames.length).toBeGreaterThan(60)
  expect(p95).toBeLessThan(50)
  expect(longTasks.filter((d) => d > 200)).toEqual([])
})
