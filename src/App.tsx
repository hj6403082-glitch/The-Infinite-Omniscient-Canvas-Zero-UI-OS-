import { Canvas } from './canvas/Canvas.tsx'
import type { CanvasController } from './canvas/canvas-controller.ts'

export default function App({ controller }: { controller: CanvasController }) {
  return <Canvas controller={controller} />
}
