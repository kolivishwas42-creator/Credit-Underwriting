import { useState, useEffect } from 'react'
import { X, Server, CheckCircle2, AlertCircle } from 'lucide-react'
import { DEFAULT_API_BASE, apiFetch, getApiBase, setApiBase } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const [url, setUrl] = useState(getApiBase())
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) {
      setUrl(getApiBase())
      setStatus('idle')
      setMessage('')
    }
  }, [open])

  if (!open) return null

  const handleSave = async () => {
    setApiBase(url)
    setStatus('checking')
    setMessage('Checking connection…')
    try {
      const res = await apiFetch('/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const health = await res.json()
      setStatus('ok')
      setMessage(
        `Connected · v${health.version || '1.0'} · Accept ≥ ${health.accept_threshold}% · Review ≥ ${health.review_threshold}%`
      )
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message || 'Could not reach API')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-800">API Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Backend API Base URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={DEFAULT_API_BASE}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Default: <code className="rounded bg-slate-100 px-1">{DEFAULT_API_BASE}</code>
            </p>
          </div>

          {message && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
                status === 'ok'
                  ? 'bg-emerald-50 text-emerald-800'
                  : status === 'error'
                  ? 'bg-red-50 text-red-800'
                  : 'bg-slate-50 text-slate-700'
              }`}
            >
              {status === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : status === 'error' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
              <span>{message}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={status === 'checking'}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-on-ink hover:bg-brand-700 disabled:opacity-60"
          >
            {status === 'checking' ? 'Testing…' : 'Save & Test'}
          </button>
        </div>
      </div>
    </div>
  )
}
