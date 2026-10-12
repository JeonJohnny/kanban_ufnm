-- An unassigned task is shared with the workspace; assigned tasks are personal.
create function private.can_task(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.tasks t join public.projects p on p.id=t.project_id
    where t.id=p_id and p.workspace_id=(private.me()).workspace_id
      and ((private.me()).role='admin' or t.assignee_member_id is null or t.assignee_member_id=(private.me()).id)
  )
$$;
revoke all on function private.can_task(uuid) from public,anon,authenticated;
grant execute on function private.can_task(uuid) to authenticated;

drop policy member_read on public.tasks;
create policy member_read on public.tasks for select to authenticated using (
  private.can_task(id) and (deleted_at is null or (select (private.me()).role)='admin')
);

drop policy member_read on public.progress_requests;
create policy member_read on public.progress_requests for select to authenticated using (
  private.can_project(project_id)
  and ((select (private.me()).role)='admin' or requester_member_id=(select (private.me()).id) or assignee_member_id=(select (private.me()).id))
  and (task_id is null or private.can_task(task_id))
);

create or replace function public.board_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members := private.me();
  t public.tasks; n public.notices; r public.progress_requests;
  object_id uuid; project uuid; assignee uuid; recipient uuid;
  next_status text; recipients uuid[];
begin
  if actor.id is null then raise exception '인증이 만료되었습니다. 다시 로그인하세요.' using errcode='42501'; end if;
  if action='logout' then
    delete from private.pin_sessions where session_id=(auth.jwt()->>'session_id')::uuid;
    return '{}'::jsonb;
  elsif action='save_project' then
    if actor.role<>'admin' then raise exception '관리자만 프로젝트를 관리할 수 있습니다.' using errcode='42501'; end if;
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is null then
      insert into public.projects(workspace_id,name,description,color) values(actor.workspace_id,trim(payload->>'name'),coalesce(payload->>'description',''),coalesce(payload->>'color','#6366f1')) returning id into object_id;
    else
      update public.projects set name=trim(payload->>'name'),description=coalesce(payload->>'description',''),color=payload->>'color',status=payload->>'status',updated_at=now() where id=object_id and workspace_id=actor.workspace_id;
      if not found then raise exception '프로젝트를 찾을 수 없습니다.'; end if;
    end if;
  elsif action in ('save_task','move_task','delete_task','restore_task') then
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is not null then
      select * into t from public.tasks where id=object_id for update;
      if t.id is null or not private.can_task(t.id) then raise exception '접근할 수 없는 태스크입니다.' using errcode='42501'; end if;
      if t.revision is distinct from (payload->>'revision')::integer then raise exception '다른 사용자가 수정했습니다. 새로 불러온 내용을 확인하세요.' using errcode='40001'; end if;
      if t.deleted_at is not null and (action<>'restore_task' or actor.role<>'admin') then raise exception '삭제된 태스크입니다.' using errcode='42501'; end if;
      project := t.project_id;
      if action='save_task' and nullif(payload->>'project_id','') is not null then
        if exists(select 1 from public.projects where id=t.project_id and status='archived') then
          raise exception '보관된 프로젝트는 먼저 복원하세요.';
        end if;
        project := (payload->>'project_id')::uuid;
      end if;
    else
      if action<>'save_task' then raise exception '태스크 ID가 필요합니다.'; end if;
      project := (payload->>'project_id')::uuid;
    end if;
    if not private.can_project(project) then raise exception '프로젝트 권한이 없습니다.' using errcode='42501'; end if;
    if exists(select 1 from public.projects where id=project and status='archived') then raise exception '보관된 프로젝트는 먼저 복원하세요.'; end if;
    if action='delete_task' then
      update public.tasks set deleted_at=now(),updated_at=now(),revision=revision+1 where id=object_id;
    elsif action='restore_task' then
      update public.tasks set deleted_at=null,archived_at=null,restored_at=now(),updated_at=now(),revision=revision+1 where id=object_id;
    else
      if t.archived_at is not null then raise exception '보관함에서 먼저 복원하세요.'; end if;
      next_status := coalesce(payload->>'status','todo');
      if action='move_task' then
        update public.tasks set status=next_status,position=(payload->>'position')::double precision,
          completed_at=case when next_status='done' then coalesce(completed_at,now()) else null end,
          restored_at=case when next_status='done' then restored_at else null end,updated_at=now(),revision=revision+1 where id=object_id;
      else
        assignee := nullif(payload->>'assignee_member_id','')::uuid;
        if assignee is not null and not exists(select 1 from public.workspace_members where id=assignee and workspace_id=actor.workspace_id and is_active) then raise exception '올바른 담당자를 선택하세요.'; end if;
        if object_id is null then
          if nullif(payload->>'source_notice_id','') is not null and not private.can_notice((payload->>'source_notice_id')::uuid) then raise exception '전달사항에 접근할 수 없습니다.' using errcode='42501'; end if;
          insert into public.tasks(project_id,title,description,status,priority,assignee_member_id,due_date,position,created_by,source_notice_id,completed_at)
          values(project,trim(payload->>'title'),coalesce(payload->>'description',''),next_status,coalesce(payload->>'priority','normal'),assignee,nullif(payload->>'due_date','')::date,
            coalesce((select max(position)+1024 from public.tasks where project_id=project and status=next_status),1024),actor.id,nullif(payload->>'source_notice_id','')::uuid,case when next_status='done' then now() end) returning id into object_id;
        else
          update public.tasks set project_id=project,
            position=case when project<>t.project_id then coalesce((select max(other.position)+1024 from public.tasks other where other.project_id=project and other.status=next_status),1024) else position end,
            title=trim(payload->>'title'),description=coalesce(payload->>'description',''),status=next_status,priority=payload->>'priority',assignee_member_id=assignee,due_date=nullif(payload->>'due_date','')::date,
            completed_at=case when next_status='done' then coalesce(completed_at,now()) else null end,
            restored_at=case when next_status='done' then restored_at else null end,updated_at=now(),revision=revision+1 where id=object_id;
        end if;
      end if;
    end if;
    if action='save_task' and t.id is not null and project<>t.project_id then
      update public.progress_requests set project_id=project where task_id=object_id;
      insert into public.task_activities(task_id,actor_member_id,event_type) values(object_id,actor.id,'move_task_project');
    end if;
    insert into public.task_activities(task_id,actor_member_id,event_type) values(object_id,actor.id,action);
  elsif action='create_notice' then
    select array_agg(distinct value::uuid) into recipients from jsonb_array_elements_text(coalesce(payload->'recipients','[]'::jsonb));
    if coalesce((payload->>'is_broadcast')::boolean,false) then
      select array_agg(id) into recipients from public.workspace_members where workspace_id=actor.workspace_id and is_active;
    end if;
    if coalesce(cardinality(recipients),0)=0 or exists(select 1 from unnest(recipients) x where not exists(select 1 from public.workspace_members where id=x and workspace_id=actor.workspace_id and is_active)) then raise exception '수신자를 선택하세요.'; end if;
    insert into public.notices(workspace_id,author_member_id,title,content,is_important,is_broadcast)
    values(actor.workspace_id,actor.id,trim(payload->>'title'),coalesce(payload->>'content',''),coalesce((payload->>'is_important')::boolean,false),coalesce((payload->>'is_broadcast')::boolean,false)) returning id into object_id;
    foreach recipient in array recipients loop
      insert into public.notice_recipients(notice_id,recipient_member_id) values(object_id,recipient);
      if recipient<>actor.id then insert into public.notifications(recipient_member_id,event_type,related_id) values(recipient,'notice',object_id); end if;
    end loop;
  elsif action='read_notice' or action='confirm_notice' then
    object_id := (payload->>'id')::uuid;
    if not private.can_notice(object_id) then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
    -- New members can also acknowledge an earlier broadcast.
    insert into public.notice_recipients(notice_id,recipient_member_id,read_at,confirmed_at)
    values(object_id,actor.id,now(),case when action='confirm_notice' then now() end)
    on conflict(notice_id,recipient_member_id) do update set read_at=coalesce(public.notice_recipients.read_at,now()),confirmed_at=case when action='confirm_notice' then coalesce(public.notice_recipients.confirmed_at,now()) else public.notice_recipients.confirmed_at end;
  elsif action='request_progress' then
    select * into t from public.tasks where id=(payload->>'task_id')::uuid for update;
    if t.id is null or not private.can_task(t.id) or t.deleted_at is not null or t.assignee_member_id is null then raise exception '담당자가 있는 태스크를 선택하세요.'; end if;
    if not exists(select 1 from public.workspace_members where id=t.assignee_member_id and is_active) then raise exception '비활성 담당자입니다.'; end if;
    insert into public.progress_requests(project_id,task_id,requester_member_id,assignee_member_id) values(t.project_id,t.id,actor.id,t.assignee_member_id) returning id into object_id;
    insert into public.notifications(recipient_member_id,event_type,related_id) values(t.assignee_member_id,'progress_request',object_id);
  elsif action='respond_progress' then
    object_id := (payload->>'id')::uuid;
    select * into r from public.progress_requests where id=object_id for update;
    if r.id is null or r.assignee_member_id<>actor.id or not private.can_project(r.project_id) or (r.task_id is not null and not private.can_task(r.task_id)) then raise exception '담당자만 응답할 수 있습니다.' using errcode='42501'; end if;
    if r.responded_at is not null then raise exception '이미 응답한 요청입니다.'; end if;
    if coalesce(length(trim(payload->>'current_work')),0)=0 or coalesce(length(trim(payload->>'blockers')),0)=0 or coalesce(length(trim(payload->>'next_steps')),0)=0 or nullif(payload->>'estimated_completion_date','') is null then raise exception '응답 항목을 모두 입력하세요. 문제점이 없으면 없음으로 작성하세요.'; end if;
    update public.progress_requests set current_work=payload->>'current_work',blockers=payload->>'blockers',next_steps=payload->>'next_steps',estimated_completion_date=(payload->>'estimated_completion_date')::date,responded_at=now() where id=object_id;
    insert into public.notifications(recipient_member_id,event_type,related_id) values(r.requester_member_id,'progress_response',object_id);
  elsif action='read_notification' then
    object_id := (payload->>'id')::uuid;
    update public.notifications set read_at=coalesce(read_at,now()) where id=object_id and recipient_member_id=actor.id;
  else raise exception '지원하지 않는 작업입니다.';
  end if;
  return jsonb_build_object('id',object_id);
end $$;
