import { deliverEmail, deliverSmtpEmail } from './email.ts'

export function mailConfig() {
  const gmail = Deno.env.get('EMAIL_PROVIDER') === 'gmail'
  const user = Deno.env.get('GMAIL_USER')?.trim()
  const password = Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s/g, '')
  const key = Deno.env.get('RESEND_API_KEY')
  const from = gmail ? `Lab Project Board <${user}>` : Deno.env.get('EMAIL_FROM')
  return { gmail, user, password, key, from, configured: gmail ? Boolean(user && password) : Boolean(key && from) }
}

export async function sendMail(requestId: string, email: { to: string; subject: string; text: string }) {
  const config = mailConfig()
  if (!config.configured) throw new Error('메일 발송 연결이 필요합니다.')
  if (!config.gmail) return deliverEmail(config.key!, config.from!, requestId, email)
  const { default: nodemailer } = await import('npm:nodemailer@10.1.0')
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  })
  try { return await deliverSmtpEmail(() => transport.sendMail({ from: config.from, ...email }), email.to) }
  finally { transport.close() }
}
