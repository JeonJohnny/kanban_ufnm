import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, description, error, children, onClose, wide = false, variant = 'form' }: { title: string; description?: string; error?: string; children: ReactNode; onClose: () => void; wide?: boolean; variant?: 'form' | 'viewer' }) {
  return <Dialog.Root open onOpenChange={open => !open && onClose()}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm" />
    <Dialog.Content onEscapeKeyDown={event => { if (event.target instanceof HTMLElement && event.target.hasAttribute('data-markdown-editor')) event.preventDefault() }} className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
      {variant === 'viewer' && <p className="mb-2 text-xs font-medium text-muted-foreground">태스크 상세</p>}
      <Dialog.Title className={variant === 'viewer' ? 'break-words pr-10 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl' : 'pr-10 text-xl font-semibold tracking-tight'}>{title}</Dialog.Title>
      <Dialog.Description className={description ? 'mt-2 text-sm text-muted-foreground' : 'sr-only'}>{description ?? (variant === 'viewer' ? `${title} 상세 내용과 댓글` : `${title} 입력 및 상세 정보`)}</Dialog.Description>
      <Dialog.Close aria-label="닫기" className="absolute right-3 top-3 grid size-11 place-items-center rounded-xl hover:bg-muted"><X size={18} /></Dialog.Close>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <div className="mt-6">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
