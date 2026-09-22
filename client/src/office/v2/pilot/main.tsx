import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PilotScene } from './PilotScene'
import './pilot.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PilotScene />
  </StrictMode>,
)
