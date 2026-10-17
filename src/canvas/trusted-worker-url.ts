// The CSP enforces Trusted Types for script URLs (require-trusted-types-for 'script'), and
// `new Worker(url)` is such a sink. This policy only mints same-origin http(s) URLs.
export const WORKER_POLICY_NAME = 'canvas-intent-worker'

interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): { createScriptURL(input: string): unknown }
}

export interface WorkerUrlPolicyOptions {
  base: string
  trustedTypes?: TrustedTypesLike
}

export function createWorkerUrlPolicy({ base, trustedTypes }: WorkerUrlPolicyOptions) {
  const origin = new URL(base).origin
  const sameOrigin = (input: string): string => {
    const url = new URL(input, base)
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) {
      throw new TypeError(`Worker scripts must be same-origin: ${input}`)
    }
    return url.href
  }
  let policy: ReturnType<TrustedTypesLike['createPolicy']> | undefined
  return (input: string): string | object => {
    if (!trustedTypes) return sameOrigin(input)
    policy ??= trustedTypes.createPolicy(WORKER_POLICY_NAME, { createScriptURL: sameOrigin })
    return policy.createScriptURL(input) as object
  }
}
