export type Member = { id: string; auth_user_id: string; workspace_id: string; display_name: string; email: string | null; role: 'admin' | 'deputy' | 'member'; is_active: boolean }
export type Project = { owner_member_id: string | null; sort_order: number; member_ids: string[]; all_members: boolean; id: string; workspace_id: string; name: string; description: string; color: string; status: 'active' | 'archived' }
export type Task = { created_by: string; id: string; project_id: string; title: string; description: string; status: 'todo' | 'ongoing' | 'done'; priority: 'normal' | 'high' | 'urgent'; assignee_member_ids: string[]; due_date: string | null; position: number; revision: number; created_at: string; updated_at: string; completed_at: string | null; archived_at: string | null; deleted_at: string | null; source_notice_id: string | null }
export type Notice = { id: string; title: string; content: string; author_member_id: string; is_important: boolean; is_broadcast: boolean; created_at: string }
export type Receipt = { notice_id: string; recipient_member_id: string; read_at: string | null; confirmed_at: string | null }
export type Progress = { id: string; project_id: string; task_id: string | null; requester_member_id: string; assignee_member_id: string; current_work: string | null; blockers: string | null; next_steps: string | null; estimated_completion_date: string | null; requested_at: string; responded_at: string | null }
export type Notification = { id: string; recipient_member_id: string; event_type: 'notice' | 'progress_request' | 'progress_response'; related_id: string; read_at: string | null; created_at: string }
export type TaskRead = { task_id: string; member_id: string; read_at: string }
export type BoardData = { members: Member[]; projects: Project[]; tasks: Task[]; notices: Notice[]; receipts: Receipt[]; progress: Progress[]; notifications: Notification[]; taskReads: TaskRead[]; comments: TaskComment[] }

export const canManage = (role: Member['role']) => role === 'admin' || role === 'deputy'
export const canWorkOnTask = (task: Task, me: Member) => canManage(me.role) || task.assignee_member_ids.length === 0 || task.assignee_member_ids.includes(me.id)
export const roleNames: Record<Member['role'], string> = { admin: '관리자', deputy: '부관리자', member: '연구원' }

export type TaskComment = { id: string; task_id: string; author_member_id: string; content: string; created_at: string; deleted_at: string | null }
