import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App smoke test', () => {
  it('renders the canvas landmark', () => {
    render(<App />)
    expect(screen.getByRole('main', { name: 'Infinite Omniscient Canvas' })).toBeInTheDocument()
  })
})
