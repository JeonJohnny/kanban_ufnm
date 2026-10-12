alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check(role in ('admin','deputy','member'));

create function public.set_member_role(p_member uuid,p_role text,p_expected_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members; target public.workspace_members;
begin
  -- Share the PIN-reset lock so a role change cannot race a privileged account reset.
  perform pg_advisory_xact_lock(91001);
  actor:=private.me();
  if actor.id is null or actor.role<>'admin' then raise exception '관리자만 연구원 권한을 변경할 수 있습니다.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('member','deputy') then raise exception '연구원 또는 부관리자 권한을 선택하세요.'; end if;
  select * into target from public.workspace_members where id=p_member and workspace_id=actor.workspace_id and is_active for update;
  if target.id is null or target.role='admin' then raise exception '변경할 수 없는 연구원입니다.' using errcode='42501'; end if;
  if target.role is distinct from p_expected_role then raise exception '권한이 변경되었습니다. 새로고침 후 다시 시도하세요.' using errcode='40001'; end if;
  update public.workspace_members set role=p_role where id=target.id;
  return jsonb_build_object('id',target.id,'role',p_role);
end $$;
revoke all on function public.set_member_role(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_member_role(uuid,text,text) to authenticated;

create or replace function private.can_project(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects p where p.id=p_id and p.workspace_id=(private.me()).workspace_id
    and ((private.me()).role in ('admin','deputy') or (private.me()).id=any(p.member_ids)))
$$;

create or replace function private.can_task(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tasks t where t.id=p_id and private.can_project(t.project_id)
    and ((private.me()).role in ('admin','deputy') or cardinality(t.assignee_member_ids)=0 or (private.me()).id=any(t.assignee_member_ids)))
$$;

create or replace function public.board_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members := private.me();
  t public.tasks; n public.notices; r public.progress_requests;
  object_id uuid; project uuid; assignee uuid; recipient uuid;
  next_status text; recipients uuid[]; assigned_members uuid[]; task_assignees uuid[];
begin
  if actor.id is null then raise exception '인증이 만료되었습니다. 다시 로그인하세요.' using errcode='42501'; end if;
  if action='logout' then
    delete from private.pin_sessions where session_id=(auth.jwt()->>'session_id')::uuid;
    return '{}'::jsonb;
  elsif action='save_project' then
    if actor.role not in ('admin','deputy') then raise exception '관리자만 프로젝트를 관리할 수 있습니다.' using errcode='42501'; end if;
    if payload ? 'member_ids' then
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into assigned_members from jsonb_array_elements_text(payload->'member_ids');
      if exists(select 1 from unnest(assigned_members) x where not exists(select 1 from public.workspace_members m where m.id=x and m.workspace_id=actor.workspace_id and m.is_active)) then
        raise exception '같은 연구실의 활성 멤버를 선택하세요.' using errcode='42501';
      end if;
    end if;
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is null then
      insert into public.projects(workspace_id,name,description,color,member_ids) values(actor.workspace_id,trim(payload->>'name'),coalesce(payload->>'description',''),coalesce(payload->>'color','#6366f1'),coalesce(assigned_members,'{}'::uuid[])) returning id into object_id;
    else
      update public.projects set name=trim(payload->>'name'),description=coalesce(payload->>'description',''),color=payload->>'color',status=payload->>'status',member_ids=coalesce(assigned_members,member_ids),updated_at=now() where id=object_id and workspace_id=actor.workspace_id;
      if not found then raise exception '프로젝트를 찾을 수 없습니다.'; end if;
    end if;
  elsif action in ('save_task','move_task','delete_task','restore_task') then
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is not null then
      select * into t from public.tasks where id=object_id for update;
      if t.id is null or not private.can_task(t.id) then raise exception '접근할 수 없는 태스크입니다.' using errcode='42501'; end if;
      if t.revision is distinct from (payload->>'revision')::integer then raise exception '다른 사용자가 수정했습니다. 새로 불러온 내용을 확인하세요.' using errcode='40001'; end if;
      if t.deleted_at is not null and (action<>'restore_task' or actor.role not in ('admin','deputy')) then raise exception '삭제된 태스크입니다.' using errcode='42501'; end if;
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
        if payload ? 'assignee_member_ids' then
          if jsonb_typeof(payload->'assignee_member_ids') is distinct from 'array' then raise exception '담당자 목록 형식이 올바르지 않습니다.'; end if;
          select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into task_assignees from jsonb_array_elements_text(payload->'assignee_member_ids');
        elsif payload ? 'assignee_member_id' then
          -- Older clients must not silently discard additional assignees.
          if cardinality(t.assignee_member_ids)>1 then raise exception '여러 담당자를 편집하려면 앱을 새로고침하세요.' using errcode='40001'; end if;
          assignee := nullif(payload->>'assignee_member_id','')::uuid;
          task_assignees := case when assignee is null then '{}'::uuid[] else array[assignee] end;
        else
          task_assignees := coalesce(t.assignee_member_ids,'{}'::uuid[]);
        end if;
        if exists(select 1 from unnest(task_assignees) x where not exists(select 1 from public.workspace_members m join public.projects p on p.id=project where m.id=x and m.workspace_id=actor.workspace_id and m.is_active and (m.role in ('admin','deputy') or m.id=any(p.member_ids)))) then raise exception '프로젝트에 할당된 담당자를 선택하세요.'; end if;
        assignee := task_assignees[1];
        if object_id is null then
          if nullif(payload->>'source_notice_id','') is not null and not private.can_notice((payload->>'source_notice_id')::uuid) then raise exception '전달사항에 접근할 수 없습니다.' using errcode='42501'; end if;
          insert into public.tasks(project_id,title,description,status,priority,assignee_member_id,assignee_member_ids,due_date,position,created_by,source_notice_id,completed_at)
          values(project,trim(payload->>'title'),coalesce(payload->>'description',''),next_status,coalesce(payload->>'priority','normal'),assignee,task_assignees,nullif(payload->>'due_date','')::date,
            coalesce((select max(position)+1024 from public.tasks where project_id=project and status=next_status),1024),actor.id,nullif(payload->>'source_notice_id','')::uuid,case when next_status='done' then now() end) returning id into object_id;
        else
          update public.tasks set project_id=project,
            position=case when project<>t.project_id then coalesce((select max(other.position)+1024 from public.tasks other where other.project_id=project and other.status=next_status),1024) else position end,
            title=trim(payload->>'title'),description=coalesce(payload->>'description',''),status=next_status,priority=payload->>'priority',assignee_member_id=assignee,assignee_member_ids=task_assignees,due_date=nullif(payload->>'due_date','')::date,
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
    if t.id is null or not private.can_task(t.id) or t.deleted_at is not null or cardinality(t.assignee_member_ids)=0 then raise exception '담당자가 있는 태스크를 선택하세요.'; end if;
    if exists(select 1 from unnest(t.assignee_member_ids) x where not exists(select 1 from public.workspace_members m join public.projects p on p.id=t.project_id where m.id=x and m.workspace_id=actor.workspace_id and m.is_active and (m.role in ('admin','deputy') or m.id=any(p.member_ids)))) then raise exception '프로젝트에 할당된 활성 담당자를 선택하세요.'; end if;
    foreach assignee in array t.assignee_member_ids loop
      insert into public.progress_requests(project_id,task_id,requester_member_id,assignee_member_id) values(t.project_id,t.id,actor.id,assignee) returning id into object_id;
      insert into public.notifications(recipient_member_id,event_type,related_id) values(assignee,'progress_request',object_id);
    end loop;
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

create or replace function public.save_member_email(p_email text, p_member uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); target uuid;
begin
  if actor.id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  target := coalesce(p_member,actor.id);
  if target<>actor.id and actor.role not in ('admin','deputy') then raise exception '본인의 이메일만 변경할 수 있습니다.' using errcode='42501'; end if;
  update public.workspace_members set email=nullif(trim(p_email),'') where id=target and workspace_id=actor.workspace_id;
  if not found then raise exception '연구원을 찾을 수 없습니다.' using errcode='42501'; end if;
  return jsonb_build_object('id',target);
end $$;

create or replace function public.admin_save_member(p_actor uuid,p_session uuid,p_user uuid,p_name text,p_pin text,p_member uuid default null,p_workspace_name text default '우리 연구실',p_email text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare administrator public.workspace_members; workspace uuid; result uuid;
begin
  if p_pin !~ '^[0-9]{4}$' or p_pin is null then raise exception 'PIN은 숫자 4자리여야 합니다.'; end if;
  perform pg_advisory_xact_lock(91001);
  if p_actor is null then
    if exists(select 1 from public.workspace_members) then raise exception '초기 관리자 설정은 이미 완료되었습니다.'; end if;
    insert into public.workspaces(name) values(p_workspace_name) returning id into workspace;
  else
    select m.* into administrator from public.workspace_members m join private.member_pins p on p.member_id=m.id join private.pin_sessions s on s.member_id=m.id and s.pin_version=p.version
    where m.auth_user_id=p_actor and m.role in ('admin','deputy') and m.is_active and s.session_id=p_session;
    if administrator.id is null then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
    workspace:=administrator.workspace_id;
  end if;
  if p_member is null then
    insert into public.workspace_members(workspace_id,auth_user_id,display_name,email,role) values(workspace,p_user,trim(p_name),nullif(trim(p_email),''),case when p_actor is null then 'admin' else 'member' end) returning id into result;
    insert into private.member_pins(member_id,pin_hash) values(result,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
  else
    select id into result from public.workspace_members where id=p_member and workspace_id=workspace;
    if result is null then raise exception '연구원을 찾을 수 없습니다.'; end if;
    -- A deputy must not take over an administrator account through a PIN reset.
    if administrator.role='deputy' and exists(select 1 from public.workspace_members where id=result and role='admin') then
      raise exception '부관리자는 관리자의 PIN을 초기화할 수 없습니다.' using errcode='42501';
    end if;
    update private.member_pins set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),version=version+1 where member_id=result;
    delete from private.pin_sessions where member_id=result;
    delete from private.login_limits where key='member:'||result::text;
  end if;
  return result;
end $$;

create or replace function public.reorder_projects(p_ids uuid[], p_previous uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); current_order uuid[];
begin
  if actor.id is null or actor.role not in ('admin','deputy') then raise exception '관리자만 프로젝트 순서를 변경할 수 있습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.workspace_id::text,1));
  select coalesce(array_agg(id order by sort_order,created_at,id),'{}'::uuid[]) into current_order from public.projects where workspace_id=actor.workspace_id;
  if p_previous is distinct from current_order then raise exception '프로젝트 목록이 변경되었습니다. 새로 불러온 뒤 다시 정렬하세요.' using errcode='40001'; end if;
  if p_ids is null or cardinality(p_ids)<>cardinality(current_order)
    or (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids)
    or exists(select 1 from unnest(p_ids) x where not(x=any(current_order))) then
    raise exception '올바른 프로젝트 목록이 필요합니다.' using errcode='42501';
  end if;
  update public.projects p set sort_order=r.position::integer,updated_at=now()
    from unnest(p_ids) with ordinality as r(id,position)
    where p.id=r.id and p.workspace_id=actor.workspace_id;
  return '{}'::jsonb;
end $$;

create or replace function public.mark_seen(p_project uuid default null,p_task uuid default null) returns jsonb
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
    insert into public.task_reads(task_id,member_id) values(p_task,actor.id) on conflict do nothing;
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.task_email_settings(p_enabled boolean default null,p_start_hour integer default null,p_end_hour integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members:=private.me(); config private.task_email_settings; stats jsonb;
begin
  if actor.id is null or actor.role not in ('admin','deputy') then raise exception '관리자만 메일 설정을 관리할 수 있습니다.' using errcode='42501'; end if;
  insert into private.task_email_settings(workspace_id) values(actor.workspace_id) on conflict do nothing;
  if p_enabled is not null or p_start_hour is not null or p_end_hour is not null then
    if p_enabled is null or p_start_hour is null or p_end_hour is null then raise exception '모든 설정 값을 입력하세요.'; end if;
    update private.task_email_settings set enabled=p_enabled,start_hour=p_start_hour,end_hour=p_end_hour where workspace_id=actor.workspace_id;
  end if;
  select * into config from private.task_email_settings where workspace_id=actor.workspace_id;
  select jsonb_build_object(
    'pending',count(*) filter(where q.status='pending'),
    'missing_email',count(*) filter(where q.status='pending' and m.email is null),
    'failed',count(*) filter(where q.status='failed'),
    'unknown',count(*) filter(where q.status in ('unknown','sending'))
  ) into stats from private.task_email_queue q join public.workspace_members m on m.id=q.member_id where m.workspace_id=actor.workspace_id;
  return to_jsonb(config)||jsonb_build_object('stats',stats);
end $$;

create or replace function public.claim_task_emails(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare recipient record; batch uuid; slot_time timestamptz:=date_trunc('hour',p_now); hour_kst integer:=extract(hour from p_now at time zone 'Asia/Seoul'); items jsonb; result jsonb:='[]';
begin
  -- Serialize reservations across overlapping cron invocations.
  perform pg_advisory_xact_lock(710013);
  update private.task_email_batches set status='unknown',updated_at=now() where status='sending' and updated_at<p_now-interval '10 minutes';
  update private.task_email_queue q set status='unknown' from private.task_email_batches b where q.batch_id=b.id and q.status='sending' and b.status='unknown';
  update private.task_email_queue q set status='cancelled' where q.status='pending' and not exists(
    select 1 from public.tasks t join public.projects p on p.id=t.project_id join public.workspace_members m on m.id=q.member_id
    where t.id=q.task_id and m.is_active and m.workspace_id=p.workspace_id and m.id=any(t.assignee_member_ids)
      and (m.role in ('admin','deputy') or m.id=any(p.member_ids)) and t.deleted_at is null and t.archived_at is null and p.status='active'
  );
  for recipient in
    select distinct m.id,m.email,m.display_name from private.task_email_queue q
    join public.workspace_members m on m.id=q.member_id
    left join private.task_email_settings s on s.workspace_id=m.workspace_id
    where q.status='pending' and q.created_at<slot_time and m.email is not null
      and coalesce(s.enabled,true) and hour_kst between coalesce(s.start_hour,9) and coalesce(s.end_hour,18)
      and not exists(select 1 from private.task_email_batches b where b.member_id=m.id and b.slot=slot_time)
    order by m.id limit 20
  loop
    insert into private.task_email_batches(member_id,slot,updated_at) values(recipient.id,slot_time,p_now) returning id into batch;
    with claimed as (
      update private.task_email_queue set status='sending',batch_id=batch
      where member_id=recipient.id and status='pending' and created_at<slot_time returning task_id
    ) select coalesce(jsonb_agg(jsonb_build_object('title',t.title,'project',p.name) order by t.created_at,t.id),'[]') into items
      from (select distinct task_id from claimed) c join public.tasks t on t.id=c.task_id join public.projects p on p.id=t.project_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',batch,'to',recipient.email,'name',recipient.display_name,'tasks',items));
  end loop;
  return result;
end $$;

drop policy member_read on public.tasks;
create policy member_read on public.tasks for select to authenticated using (
  private.can_task(id) and (deleted_at is null or (select (private.me()).role) in ('admin','deputy'))
);

drop policy member_read on public.progress_requests;
create policy member_read on public.progress_requests for select to authenticated using (
  private.can_project(project_id)
  and ((select (private.me()).role) in ('admin','deputy') or requester_member_id=(select (private.me()).id) or assignee_member_id=(select (private.me()).id))
  and (task_id is null or private.can_task(task_id))
);

