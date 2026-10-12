import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, Columns3, KeyRound, LoaderCircle, Moon, Sun } from 'lucide-react'
import { Button } from './components/ui/button'
import { authStorageKey, configured, currentMember, edge, supabase } from './lib/api'
import Workspace from './components/Workspace'

export default function App() {
  const client = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('lab-theme') === 'dark' || (!localStorage.getItem('lab-theme') && matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('lab-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => {
    if (!supabase) { setReady(true); return }
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setReady(true); if (!value) client.clear() })
    return () => data.subscription.unsubscribe()
  }, [client])
  const member = useQuery({ queryKey: ['member', session?.user.id], queryFn: currentMember, enabled: !!session, refetchInterval: 30_000 })
  async function leave() {
    const result = await supabase?.auth.signOut({ scope: 'local' })
    client.clear(); setSession(null)
    if (result?.error) { localStorage.removeItem(authStorageKey); window.location.reload() }
  }
  const theme = <Button variant="ghost" size="icon" aria-label={dark ? '라이트 모드' : '다크 모드'} onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />}</Button>
  if (!configured) return <div className="grid min-h-dvh place-items-center p-6"><div className="panel w-full max-w-lg p-8"><Brand /><h1 className="mt-8 text-2xl font-semibold">연구실 보드를 연결해 주세요</h1><p className="mt-3 leading-7 text-muted-foreground">앱이 준비되었습니다. 이 기기의 Supabase 연결 설정을 완료하면 연구원 로그인 화면이 표시됩니다.</p><ol className="my-6 list-decimal space-y-3 pl-5 text-sm"><li><code>.env.local</code>의 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>에 확인한 publishable key 입력</li><li>Supabase 마이그레이션과 함수를 배포하고 초기 관리자 생성</li><li>개발 서버를 다시 실행</li></ol><p className="caption">자세한 순서는 로컬 「개발 준비.md」에 정리되어 있습니다.</p><div className="mt-4 flex justify-end">{theme}</div></div></div>
  if (!ready || (session && member.isPending)) return <div className="grid min-h-dvh place-items-center"><LoaderCircle className="animate-spin" aria-label="로그인 확인 중" /></div>
  if (session && (member.isError || !member.data)) return <div className="grid min-h-dvh place-items-center p-6"><div className="panel max-w-md space-y-4 p-8"><h1 className="text-xl font-semibold">로그인 상태를 확인해 주세요</h1><p className="text-sm text-muted-foreground">{member.isError ? '서버 연결에 실패했습니다. 연결을 확인한 후 다시 시도하세요.' : 'PIN이 변경되었거나 접근 권한이 만료되었습니다.'}</p><Button onClick={() => member.refetch()}>다시 확인</Button> <Button variant="outline" onClick={leave}>로그인 화면으로</Button></div></div>
  if (session && member.data) return <Workspace me={member.data} theme={theme} onLeave={leave} />
  return <Login theme={theme} />
}

export function Brand() {
  return <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Columns3 size={21} /></span><div><p className="text-sm font-semibold tracking-tight">Lab Project Board</p><p className="text-[10px] font-medium tracking-[.16em] text-muted-foreground">A SHARED SPACE FOR RESEARCH</p></div></div>
}
function Login({ theme }: { theme: React.ReactNode }) {
  const roster = useQuery({ queryKey: ['roster'], queryFn: async () => (await edge('pin-auth', { action: 'roster' })).members as { id: string; display_name: string }[], refetchInterval: 60_000 })
  const [selected, setSelected] = useState<{ id: string; display_name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const data = await edge('pin-auth', { member_id: selected!.id, pin })
      setPin('')
      const { error } = await supabase!.auth.setSession(data.session)
      if (error) throw error
    } catch (e) { setError(e instanceof Error ? e.message : '로그인에 실패했습니다.'); setPin('') }
    finally { setBusy(false) }
  }
  return <div className="relative flex min-h-dvh flex-col"><header className="flex items-center justify-between px-6 py-5 md:px-12"><Brand />{theme}</header><main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-24"><div className="mb-8"><p className="mb-3 text-xs font-semibold tracking-widest text-primary">WELCOME TO YOUR LAB</p><h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">오늘의 연구를,<br />함께 이어가세요.</h1><p className="mt-4 text-muted-foreground">{selected ? `${selected.display_name} 님의 PIN을 입력해 주세요.` : '이름을 선택해 연구실에 입장하세요.'}</p></div>
    {!selected ? <><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{roster.data?.map((m, i) => <button key={m.id} className="panel flex min-h-32 flex-col items-center justify-center gap-3 transition-colors hover:border-primary focus-visible:border-primary" onClick={() => { setSelected(m); setError('') }}><span className={`grid size-11 place-items-center rounded-full font-semibold ${['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700'][i % 3]}`}>{m.display_name.slice(-2)}</span><span className="text-sm font-medium">{m.display_name}</span></button>)}</div>{roster.isPending && <p className="empty">연구원 목록을 불러오는 중…</p>}{roster.isError && <div className="panel p-5"><p role="alert" className="mb-3 text-sm">로그인 서버에 연결할 수 없습니다. Supabase 함수 배포 상태를 확인하세요.</p><Button variant="outline" onClick={() => roster.refetch()}>다시 시도</Button></div>}{roster.data?.length === 0 && <p className="panel p-6 text-sm text-muted-foreground">등록된 연구원이 없습니다. 초기 관리자를 먼저 생성해 주세요.</p>}</> : <form onSubmit={login} className="panel space-y-5 p-7"><Button type="button" variant="ghost" onClick={() => { setSelected(null); setPin(''); setError('') }}><ArrowLeft />이름 다시 선택</Button><label>개인 PIN<input autoFocus type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" required className="text-center !text-3xl tracking-[.6em]" /></label>{error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}<Button className="w-full" disabled={busy || pin.length !== 4}>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}연구실 입장</Button></form>}
    <p className="mt-7 flex items-center justify-center gap-2 text-xs text-muted-foreground"><KeyRound size={14} />PIN을 잊으셨다면 연구실 관리자에게 요청하세요.</p></main><footer className="pb-6 text-center text-xs text-muted-foreground">작은 진행도, 함께 기록하면 연구의 다음이 됩니다.</footer></div>
}
