import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// StrictMode is intentionally disabled — it double-invokes the async WebGPURenderer
// gl factory which causes "canvas.getContext is not a function" in development.
createRoot(document.getElementById('root')).render(<App />)
