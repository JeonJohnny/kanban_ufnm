import { createClient } from '@supabase/supabase-js'
import type { BoardData, Member } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(url?.startsWith('https://') && key && !key.includes('replace_me'))
export const authStorageKey = 'lab-board-auth'
export const supabase = configured ? createClient(url, key, { auth: { storageKey: authStorageKey } }) : null
export async function edge(name: string, payload: object) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.')
  const { data, error } = await supabase.functions.invoke(name, { body: payload })
  if (error) {
    let message = '서버 연결을 확인하세요.'
    if (error.context instanceof Response) {
      const result = await error.context.json().catch(() => null)
      message = result?.error ?? message
    }
    throw Object.assign(new Error(message), { status: error.context instanceof Response ? error.context.status : undefined })
  }
  if (data?.error) throw new Error(data.error)
  return data
}
export async function currentMember(): Promise<Member | null> {
  const { data, error } = await supabase!.rpc('current_member')
  if (error) throw error
  return data?.id ? data : null
}
export async function loadBoard(): Promise<BoardData> {
  const pairs = [['members', 'workspace_members'], ['projects', 'projects'], ['tasks', 'tasks'], ['notices', 'notices'], ['receipts', 'notice_recipients'], ['progress', 'progress_requests'], ['notifications', 'notifications'], ['taskReads', 'task_reads']] as const
  const entries = await Promise.all(pairs.map(async ([key, table]) => {
    const all = []
    // PostgREST caps each page; continue so archived tasks remain searchable as the lab grows.
    for (let start = 0; ; start += 500) {
      let query = supabase!.from(table).select('*')
      if (table === 'projects') query = query.order('sort_order').order('created_at')
      query = query.order(table === 'notice_recipients' ? 'notice_id' : table === 'task_reads' ? 'task_id' : 'id')
      if (table === 'notice_recipients') query = query.order('recipient_member_id')
      const { data, error } = await query.range(start, start + 499)
      if (error) throw error
      all.push(...data)
      if (data.length < 500) break
    }
    return [key, all]
  }))
  return Object.fromEntries(entries) as BoardData
}
export async function action(name: string, payload: object = {}) {
  if (!navigator.onLine) throw new Error('오프라인에서는 변경할 수 없습니다. 연결 후 다시 시도하세요.')
  const { data, error } = name === 'change_pin'
    ? await supabase!.rpc('change_own_pin', payload)
    : name === 'save_member_email' ? await supabase!.rpc('save_member_email', payload)
    : name === 'reorder_projects' ? await supabase!.rpc('reorder_projects', payload)
    : name === 'mark_seen' ? await supabase!.rpc('mark_seen', payload)
    : name === 'set_member_role' ? await supabase!.rpc('set_member_role', payload)
    : await supabase!.rpc('board_action', { action: name, payload })
  if (error?.code === '23514' && name === 'save_member_email') throw new Error('이메일 주소 형식을 확인하세요.')
  if (error) throw new Error(error.code === '40001' && name !== 'reorder_projects' && name !== 'set_member_role' ? '다른 사용자가 수정했습니다. 이 창을 닫고 태스크를 다시 열어 최신 내용을 확인하세요. 입력 내용은 저장되지 않았습니다.' : error.message)
  if (data?.error) throw new Error(data.error)
  return data
}
