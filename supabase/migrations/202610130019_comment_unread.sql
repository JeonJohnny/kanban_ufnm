drop function public.mark_seen(uuid,uuid);

create function public.mark_seen(p_project uuid default null,p_task uuid default null,p_seen_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me();
begin
  if actor.id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if (p_project is null)=(p_task is null) then raise exception '확인할 항목 하나를 선택하세요.'; end if;
  if p_project is not null then
    if not private.can_project(p_project) then raise exception '프로젝트 권한이 없습니다.' using errcode='42501'; end if;
    insert into public.project_reads(project_id,member_id) values(p_project,actor.id) on conflict do nothing;
  else
    if not private.can_task(p_task) or not exists(select 1 from public.tasks where id=p_task and (deleted_at is null or actor.role in ('admin','deputy'))) then
      raise exception '태스크 권한이 없습니다.' using errcode='42501';
    end if;
    insert into public.task_reads(task_id,member_id,read_at) values(p_task,actor.id,least(coalesce(p_seen_at,clock_timestamp()),clock_timestamp()))
    on conflict(task_id,member_id) do update set read_at=greatest(public.task_reads.read_at,excluded.read_at);
  end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.mark_seen(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mark_seen(uuid,uuid,timestamptz) to authenticated;
