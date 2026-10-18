// Queries through open shadow roots (lit basic-catalog elements render children there).
export function queryDeep(root: ParentNode, selector: string): Element | null {
  const direct = root.querySelector(selector)
  if (direct) return direct
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const found = queryDeep(element.shadowRoot, selector)
      if (found) return found
    }
  }
  return null
}

export function textDeep(root: Node): string {
  let text = ''
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ''
    else text += textDeep(child)
  }
  if (root instanceof Element && root.shadowRoot) text += textDeep(root.shadowRoot)
  return text
}
