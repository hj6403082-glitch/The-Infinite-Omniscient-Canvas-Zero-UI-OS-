// Single source of truth for the Content Security Policy (CLAUDE.md §2).
// Node-safe: imported by vite.config.ts as well as by tests.

const DIRECTIVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['default-src', ["'self'"]],
  // 'wasm-unsafe-eval' is required to compile the LiteRT.js WebAssembly runtime.
  ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
  ['style-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['require-trusted-types-for', ["'script'"]],
]

export const CSP_POLICY = DIRECTIVES.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')

export function parseCsp(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name, values]),
  )
}

// The dev server relies on inline HMR scripts and injected <style> tags, so the
// policy is only injected into production builds.
export function cspMetaPlugin() {
  return {
    name: 'canvas:csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string): string {
      const head = /<head[^>]*>/i.exec(html)
      if (!head) throw new Error('cspMetaPlugin: index.html has no <head> to inject the CSP into')
      const at = head.index + head[0].length
      const meta = `\n    <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`
      return html.slice(0, at) + meta + html.slice(at)
    },
  }
}
