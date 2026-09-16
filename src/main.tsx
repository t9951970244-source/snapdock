import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Без StrictMode: в dev он монтирует дважды и звук захватывается двумя потоками
createRoot(document.getElementById('root')!).render(<App />)
