create table public.project_reads (
  project_id uuid not null references public.projects on delete cascade,
  member_id uuid not null references public.workspace_members on delete cascade,
  read_at timestamptz not null default now(),
  primary key(project_id,member_id)
);
create table public.task_reads (
  task_id uuid not null references public.tasks on delete cascade,
  member_id uuid not null references public.workspace_members on delete cascade,
  read_at timestamptz not null default now(),
  primary key(task_id,member_id)
);
create index on public.project_reads(member_id);
create index on public.task_reads(member_id);
alter table public.project_reads enable row level security;
alter table public.task_reads enable row level security;
revoke all on public.project_reads,public.task_reads from anon,authenticated;
grant select on public.project_reads,public.task_reads to authenticated;
create policy own_read on public.project_reads for select to authenticated using (member_id=(select (private.me()).id) and private.can_project(project_id));
create policy own_read on public.task_reads for select to authenticated using (member_id=(select (private.me()).id) and exists(select 1 from public.tasks where id=task_id));

create function public.mark_seen(p_project uuid default null,p_task uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me();
begin
  if actor.id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if (p_project is null)=(p_task is null) then raise exception '확인할 항목 하나를 선택하세요.'; end if;
  if p_project is not null then
    if not private.can_project(p_project) then raise exception '프로젝트 권한이 없습니다.' using errcode='42501'; end if;
    insert into public.project_reads(project_id,member_id) values(p_project,actor.id) on conflict do nothing;
  else
    if not private.can_task(p_task) or not exists(select 1 from public.tasks where id=p_task and (deleted_at is null or actor.role='admin')) then
      raise exception '태스크 권한이 없습니다.' using errcode='42501';
    end if;
    insert into public.task_reads(task_id,member_id) values(p_task,actor.id) on conflict do nothing;
  end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.mark_seen(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_seen(uuid,uuid) to authenticated;
alter publication supabase_realtime add table public.project_reads,public.task_reads;
