import { describe, expect, it, vi } from 'vitest'
import { createWorkerUrlPolicy, WORKER_POLICY_NAME } from './trusted-worker-url.ts'

const BASE = 'https://canvas.example/app/'

describe('Trusted Types worker URL policy (CSP require-trusted-types-for)', () => {
  it('resolves same-origin worker URLs', () => {
    const toUrl = createWorkerUrlPolicy({ base: BASE })
    expect(toUrl('/assets/intent.worker-abc.js')).toBe('https://canvas.example/assets/intent.worker-abc.js')
  })

  it('refuses cross-origin and non-http(s) worker URLs', () => {
    const toUrl = createWorkerUrlPolicy({ base: BASE })
    expect(() => toUrl('https://evil.example/w.js')).toThrow(/same-origin/)
    expect(() => toUrl('//evil.example/w.js')).toThrow(/same-origin/)
    expect(() => toUrl('data:text/javascript,postMessage(1)')).toThrow(/same-origin/)
    expect(() => toUrl('blob:https://canvas.example/123')).toThrow(/same-origin/)
  })

  it('mints TrustedScriptURLs through a named policy when Trusted Types are enforced', () => {
    const trusted = { toString: () => 'trusted' }
    const createScriptURL = vi.fn(() => trusted)
    const createPolicy = vi.fn((_name: string, rules: { createScriptURL(input: string): string }) => ({
      createScriptURL: (input: string) => (rules.createScriptURL(input), createScriptURL()),
    }))
    const toUrl = createWorkerUrlPolicy({ base: BASE, trustedTypes: { createPolicy } })
    expect(toUrl('/w.js')).toBe(trusted)
    expect(toUrl('/w2.js')).toBe(trusted)
    expect(createPolicy).toHaveBeenCalledTimes(1)
    expect(createPolicy.mock.calls[0][0]).toBe(WORKER_POLICY_NAME)
    expect(() => toUrl('https://evil.example/w.js')).toThrow(/same-origin/)
  })
})
