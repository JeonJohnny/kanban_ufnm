import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './lib/appUpdate'
import App from './App'
import './index.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 }, mutations: { retry: false } } })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><HashRouter><App /></HashRouter></QueryClientProvider></React.StrictMode>)
