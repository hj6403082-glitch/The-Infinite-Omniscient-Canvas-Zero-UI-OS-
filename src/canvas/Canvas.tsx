import { A2uiSurface } from '@a2ui/react/v0_9'
import { useEffect, useId, useSyncExternalStore } from 'react'
import type { ToolName } from '../inference/intent-decoder.ts'
import type { AcceleratorTarget } from '../inference/types.ts'
import type { CanvasController, CanvasSnapshot, CanvasSurface } from './canvas-controller.ts'
import './Canvas.css'

const TOOL_TITLES: Record<ToolName, string> = {
  searchFiles: 'File search',
  showStatus: 'System status',
}

const ACCELERATOR_BADGES: Record<AcceleratorTarget, string> = {
  'webnn-npu': 'WebNN · NPU',
  webgpu: 'WebGPU · GPU',
  wasm: 'WASM · CPU',
}

const titleOf = (surfaceId: string) => TOOL_TITLES[surfaceId.split('-')[0] as ToolName] ?? 'Task'

function AcceleratorBadge({ snapshot }: { snapshot: CanvasSnapshot }) {
  const label =
    snapshot.phase === 'failed'
      ? 'Inference unavailable'
      : snapshot.accelerator
        ? ACCELERATOR_BADGES[snapshot.accelerator]
        : 'Loading on-device model…'
  const title = snapshot.fallbacks.length > 0 ? `Fell back from:\n${snapshot.fallbacks.join('\n')}` : undefined
  return (
    <span role="status" aria-label="Accelerator" className="indicator" data-phase={snapshot.phase} title={title}>
      {label}
    </span>
  )
}

function Indicators({ snapshot }: { snapshot: CanvasSnapshot }) {
  const { created, deleted } = snapshot.tensors
  return (
    <div className="indicators">
      <AcceleratorBadge snapshot={snapshot} />
      <span role="status" aria-label="Tensor ledger" className="indicator">
        {created} created · {deleted} deleted · {created - deleted} live
      </span>
      <span role="status" aria-label="Last intent" className="indicator">
        {snapshot.lastIntent
          ? `${TOOL_TITLES[snapshot.lastIntent.tool]} · ${Math.round(snapshot.lastIntent.confidence * 100)}%`
          : 'No intent yet'}
      </span>
    </div>
  )
}

function SurfaceFrame({ surface, onDismiss }: { surface: CanvasSurface; onDismiss(): void }) {
  const headingId = useId()
  const title = titleOf(surface.id)
  return (
    <section className="surface" aria-labelledby={headingId}>
      <header className="surface-header">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="surface-dismiss" aria-label={`Dismiss ${title}`} onClick={onDismiss}>
          ×
        </button>
      </header>
      <div className="surface-body">
        <A2uiSurface surface={surface} />
      </div>
    </section>
  )
}

export function Canvas({ controller }: { controller: CanvasController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) =>
      controller.pointer(event.clientX / window.innerWidth, event.clientY / window.innerHeight)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [controller])

  return (
    <div className="shell">
      <header className="bar">
        <span className="brand">Infinite Canvas</span>
        <input
          type="search"
          className="command-bar"
          aria-label="Command bar"
          placeholder="Ask anything… “find my invoices”, “system status”"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(event) => controller.text(event.target.value)}
        />
        <Indicators snapshot={snapshot} />
      </header>
      <main className="canvas" aria-label="Infinite Omniscient Canvas">
        {snapshot.surfaces.length === 0 ? (
          <p className="canvas-hint">
            Start typing. An on-device model predicts what you need and the canvas builds it, then clears it when
            you are done.
          </p>
        ) : (
          snapshot.surfaces.map((surface) => (
            <SurfaceFrame key={surface.id} surface={surface} onDismiss={() => controller.dismiss(surface.id)} />
          ))
        )}
      </main>
      <footer className="notices" role="log" aria-live="polite" aria-label="Notices">
        {snapshot.notices.map((notice, index) => (
          <p key={`${index}-${notice}`}>{notice}</p>
        ))}
      </footer>
    </div>
  )
}
