import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './shared/components'
import './shared/styles/theme.css'
import { router } from './router'
import { setAuthToken } from './shared/lib/http'
import { storedToken } from './entities/auth'

// a browser that signed in with a login link keeps its token (the preview passes its own in the URL)
setAuthToken(storedToken())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
)
