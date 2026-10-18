// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { CSP_POLICY, cspMetaPlugin, parseCsp } from './csp.ts'

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>t</title>
  </head>
  <body></body>
</html>`

describe('Content Security Policy (CLAUDE.md §2)', () => {
  it('matches the mandated directives exactly', () => {
    expect(parseCsp(CSP_POLICY)).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'wasm-unsafe-eval'"],
      'style-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'require-trusted-types-for': ["'script'"],
    })
  })

  it('never allows inline or eval script execution', () => {
    const scriptSrc = parseCsp(CSP_POLICY)['script-src']
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('only applies to production builds (dev server needs inline HMR scripts)', () => {
    expect(cspMetaPlugin().apply).toBe('build')
  })

  it('injects the policy as the first <head> child so it governs everything after it', () => {
    const out = cspMetaPlugin().transformIndexHtml(HTML)
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`
    expect(out).toContain(meta)
    expect(out.indexOf(meta)).toBeLessThan(out.indexOf('<meta charset'))
  })

  it('fails loudly if the HTML has no <head>', () => {
    expect(() => cspMetaPlugin().transformIndexHtml('<html></html>')).toThrow(/<head>/)
  })
})

describe('Content Security Policy header (also governs workers)', () => {
  it('extends the meta policy with header-only directives', async () => {
    const { CSP_HEADER_POLICY } = await import('./csp.ts')
    expect(parseCsp(CSP_HEADER_POLICY)).toEqual({ ...parseCsp(CSP_POLICY), 'frame-ancestors': ["'none'"] })
  })
})

describe('deployable security headers', () => {
  it('serves the header CSP plus nosniff and no-referrer', async () => {
    const { CSP_HEADER_POLICY, SECURITY_HEADERS } = await import('./csp.ts')
    expect(SECURITY_HEADERS).toEqual({
      'Content-Security-Policy': CSP_HEADER_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
  })

  it('emits a _headers file (Netlify / Cloudflare Pages format) applying them to every path', async () => {
    const { CSP_HEADER_POLICY, cspMetaPlugin } = await import('./csp.ts')
    const emitFile = vi.fn()
    cspMetaPlugin().generateBundle.call({ emitFile })
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: '_headers', source: expect.any(String) })
    const source = emitFile.mock.calls[0][0].source as string
    expect(source.split('\n')).toEqual(
      expect.arrayContaining([
        '/*',
        `  Content-Security-Policy: ${CSP_HEADER_POLICY}`,
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '/litert-wasm/*.wasm',
        '  Content-Type: application/wasm',
      ]),
    )
  })
})
