import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { createCanvasController } from './canvas/canvas-controller.ts'

describe('App smoke test', () => {
  it('renders the canvas landmark and command bar', () => {
    render(<App controller={createCanvasController({ send: () => undefined })} />)
    expect(screen.getByRole('main', { name: 'Infinite Omniscient Canvas' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Command bar' })).toBeInTheDocument()
  })
})
