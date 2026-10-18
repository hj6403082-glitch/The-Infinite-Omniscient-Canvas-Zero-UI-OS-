import { describe, expect, it, vi } from 'vitest'
import { installWorkerTrustedTypes } from './worker-trusted-types.ts'

function fakeScope() {
  const policies = new Map<string, { createScriptURL(input: string): string }>()
  const scope = {
    location: { href: 'https://canvas.example/assets/intent.worker-abc.js' },
    trustedTypes: {
      createPolicy: vi.fn((name: string, rules: { createScriptURL(input: string): string }) => {
        policies.set(name, rules)
        return rules
      }),
    },
  }
  return { scope, policies }
}

describe('worker Trusted Types default policy (header CSP applies to workers)', () => {
  it('installs a default policy that admits only LiteRT glue scripts under the wasm path', () => {
    const { scope, policies } = fakeScope()
    expect(installWorkerTrustedTypes(scope, '/litert-wasm/')).toBe(true)
    const policy = policies.get('default')!
    expect(policy.createScriptURL('https://canvas.example/litert-wasm/litert_wasm_jspi_internal.js')).toBe(
      'https://canvas.example/litert-wasm/litert_wasm_jspi_internal.js',
    )
    expect(policy.createScriptURL('/litert-wasm/litert_wasm_internal.js')).toBe(
      'https://canvas.example/litert-wasm/litert_wasm_internal.js',
    )
  })

  it('rejects anything else', () => {
    const { scope, policies } = fakeScope()
    installWorkerTrustedTypes(scope, '/litert-wasm/')
    const policy = policies.get('default')!
    for (const url of [
      'https://evil.example/litert-wasm/litert_wasm_internal.js',
      '/assets/other.js',
      '/litert-wasm/../assets/evil.js',
      '/litert-wasm/litert_wasm_internal.wasm',
      'data:text/javascript,alert(1)',
      'blob:https://canvas.example/1',
    ]) {
      expect(() => policy.createScriptURL(url), url).toThrow(/Blocked script URL/)
    }
  })

  it('is a no-op where Trusted Types are unsupported', () => {
    expect(installWorkerTrustedTypes({ location: { href: 'https://x.example/w.js' } }, '/litert-wasm/')).toBe(false)
  })
})
