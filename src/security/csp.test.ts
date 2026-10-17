// @vitest-environment node
import { describe, expect, it } from 'vitest'
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
