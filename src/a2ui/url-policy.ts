// URL policy for URL-bearing component props (CLAUDE.md §2). The CSP only allows same-origin
// subresources (default-src 'self'), so remote origins must be approved here AND in the CSP.
export const APPROVED_ORIGINS: readonly string[] = []

export function isAllowedUrl(value: string, approvedOrigins: readonly string[] = APPROVED_ORIGINS): boolean {
  // Same-origin absolute path: no scheme, no protocol-relative host, no backslash tricks.
  if (/^\/(?![/\\])[^\s\\]*$/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && approvedOrigins.includes(url.origin)
  } catch {
    return false
  }
}
