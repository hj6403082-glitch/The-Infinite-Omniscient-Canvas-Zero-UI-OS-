// When the CSP arrives as an HTTP header it also governs this worker, including
// require-trusted-types-for 'script'. LiteRT.js then calls importScripts() with a plain string,
// which only a Trusted Types *default* policy can admit. Admit LiteRT's glue scripts and nothing else.

interface WorkerScopeLike {
  location: { href: string }
  trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(input: string): string }): unknown }
}

export function installWorkerTrustedTypes(scope: WorkerScopeLike, wasmPath: string): boolean {
  if (!scope.trustedTypes) return false
  const base = new URL(wasmPath, scope.location.href)
  scope.trustedTypes.createPolicy('default', {
    createScriptURL(input: string): string {
      const url = new URL(input, scope.location.href)
      const file = url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : ''
      if (url.origin !== base.origin || !/^litert_wasm_[a-z_]+\.js$/.test(file)) {
        throw new TypeError(`Blocked script URL: ${input}`)
      }
      return url.href
    },
  })
  return true
}
