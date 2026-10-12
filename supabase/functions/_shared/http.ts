import { createClient } from 'npm:@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}
export function preflight(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용합니다.' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 8192) return json({ error: '요청이 너무 큽니다.' }, 413)
}
export async function body(req: Request) {
  const text = await req.text()
  if (text.length > 8192) throw new Error('요청이 너무 큽니다.')
  return JSON.parse(text)
}
export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export const isPin = (value: unknown): value is string => typeof value === 'string' && /^\d{4}$/.test(value)
export function sessionId(jwt: string) {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(part)).session_id as string
}
