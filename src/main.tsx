import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

registerSW({ onNeedRefresh() { window.dispatchEvent(new Event('app-update-ready')) } })
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 }, mutations: { retry: false } } })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><HashRouter><App /></HashRouter></QueryClientProvider></React.StrictMode>)
