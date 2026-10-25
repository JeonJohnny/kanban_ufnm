-- Preserve project data for administrator recovery; exclude it from application access.
alter table public.projects add column deleted_at timestamptz;
alter table public.projects add constraint deleted_project_archived check (deleted_at is null or status='archived');

create or replace function private.can_project(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects p where p.id=p_id and p.deleted_at is null
    and p.workspace_id=(private.me()).workspace_id
    and ((private.me()).role in ('admin','deputy')
      or case when p.owner_member_id is not null then p.owner_member_id=(private.me()).id
        else p.all_members or (private.me()).id=any(p.member_ids) end));
$$;

create or replace function public.board_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members := private.me();
  t public.tasks; n public.notices; r public.progress_requests; target_project public.projects;
  object_id uuid; project uuid; assignee uuid; recipient uuid;
  next_status text; recipients uuid[]; assigned_members uuid[]; task_assignees uuid[];
  include_all boolean;
begin
  if actor.id is null then raise exception '인증이 만료되었습니다. 다시 로그인하세요.' using errcode='42501'; end if;
  if action='logout' then
    delete from private.pin_sessions where session_id=(auth.jwt()->>'session_id')::uuid;
    return '{}'::jsonb;
  elsif action='delete_project' then
    if actor.role not in ('admin','deputy') then
      raise exception '관리자·부관리자만 프로젝트를 삭제할 수 있습니다.' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(actor.workspace_id::text,1));
    object_id := (payload->>'id')::uuid;
    select * into target_project from public.projects where id=object_id for update;
    if target_project.id is null or target_project.workspace_id<>actor.workspace_id or target_project.deleted_at is not null then
      raise exception '삭제할 수 없는 프로젝트입니다.' using errcode='42501';
    end if;
    if target_project.name is distinct from payload->>'name' then
      raise exception '프로젝트 이름이 일치하지 않습니다. 최신 이름을 확인하세요.';
    end if;
    update public.projects set deleted_at=now(),status='archived',updated_at=now() where id=object_id;
    update private.task_email_queue q set status='cancelled'
      where q.status='pending' and exists(select 1 from public.tasks queued_task where queued_task.id=q.task_id and queued_task.project_id=object_id);
    update public.notifications notification set read_at=coalesce(notification.read_at,now())
      where notification.event_type in ('progress_request','progress_response')
        and exists(select 1 from public.progress_requests request where request.id=notification.related_id and request.project_id=object_id);
  elsif action='save_project' then
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is not null then
      select * into target_project from public.projects where id=object_id for update;
      if target_project.id is null or target_project.deleted_at is not null or target_project.workspace_id<>actor.workspace_id
        or (actor.role not in ('admin','deputy') and target_project.owner_member_id is distinct from actor.id) then
        raise exception '프로젝트 소유자 또는 관리자만 설정할 수 있습니다.' using errcode='42501';
      end if;
    end if;
    if payload ? 'all_members' then
      if jsonb_typeof(payload->'all_members') <> 'boolean' then raise exception '전체 멤버 설정은 참 또는 거짓이어야 합니다.'; end if;
      include_all := (payload->>'all_members')::boolean;
    end if;
    if payload ? 'member_ids' then
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into assigned_members from jsonb_array_elements_text(payload->'member_ids');
      if exists(select 1 from unnest(assigned_members) x where not exists(select 1 from public.workspace_members m where m.id=x and m.workspace_id=actor.workspace_id and m.is_active)) then
        raise exception '같은 연구실의 활성 멤버를 선택하세요.' using errcode='42501';
      end if;
    end if;
    if (object_id is null and actor.role='member') or target_project.owner_member_id is not null then
      if coalesce(include_all,false) or exists(select 1 from unnest(assigned_members) x where x<>coalesce(target_project.owner_member_id,actor.id)) then
        raise exception '개인 프로젝트는 본인과 관리자·부관리자만 접근할 수 있습니다.' using errcode='42501';
      end if;
      assigned_members := array[coalesce(target_project.owner_member_id,actor.id)];
      include_all := false;
    end if;
    if object_id is null then
      insert into public.projects(workspace_id,name,description,color,member_ids,all_members,owner_member_id) values(actor.workspace_id,trim(payload->>'name'),coalesce(payload->>'description',''),coalesce(payload->>'color','#6366f1'),coalesce(assigned_members,'{}'::uuid[]),coalesce(include_all,false),case when actor.role='member' then actor.id end) returning id into object_id;
    else
      update public.projects set name=trim(payload->>'name'),description=coalesce(payload->>'description',''),color=payload->>'color',status=payload->>'status',member_ids=coalesce(assigned_members,member_ids),all_members=coalesce(include_all,all_members),updated_at=now() where id=object_id and workspace_id=actor.workspace_id;
      if not found then raise exception '프로젝트를 찾을 수 없습니다.'; end if;
    end if;
  elsif action in ('save_task','move_task','delete_task','restore_task') then
    object_id := nullif(payload->>'id','')::uuid;
    if object_id is not null then
      select * into t from public.tasks where id=object_id for update;
      if t.id is null or not private.can_task(t.id) or (action in ('move_task','restore_task') and not private.can_work_on_task(t.id)) then raise exception '접근할 수 없는 태스크입니다.' using errcode='42501'; end if;
      if action in ('save_task','delete_task') and t.created_by<>actor.id and actor.role not in ('admin','deputy') then
        raise exception '태스크 생성자 또는 관리자만 내용을 수정하거나 삭제할 권한이 있습니다.' using errcode='42501';
      end if;
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
        if exists(select 1 from unnest(task_assignees) x where not exists(select 1 from public.workspace_members m join public.projects p on p.id=project where m.id=x and m.workspace_id=actor.workspace_id and m.is_active and (m.role<>'admin' and (m.role='deputy' or case when p.owner_member_id is not null then m.id=p.owner_member_id else p.all_members or m.id=any(p.member_ids) end)))) then raise exception '프로젝트에 할당된 담당자를 선택하세요.'; end if;
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
    if t.id is null or not private.can_work_on_task(t.id) or t.deleted_at is not null or cardinality(t.assignee_member_ids)=0 then raise exception '담당자가 있는 태스크를 선택하세요.'; end if;
    if exists(select 1 from unnest(t.assignee_member_ids) x where not exists(select 1 from public.workspace_members m join public.projects p on p.id=t.project_id where m.id=x and m.workspace_id=actor.workspace_id and m.is_active and (m.role<>'admin' and (m.role='deputy' or case when p.owner_member_id is not null then m.id=p.owner_member_id else p.all_members or m.id=any(p.member_ids) end)))) then raise exception '프로젝트에 할당된 활성 담당자를 선택하세요.'; end if;
    foreach assignee in array t.assignee_member_ids loop
      insert into public.progress_requests(project_id,task_id,requester_member_id,assignee_member_id) values(t.project_id,t.id,actor.id,assignee) returning id into object_id;
      insert into public.notifications(recipient_member_id,event_type,related_id) values(assignee,'progress_request',object_id);
    end loop;
  elsif action='respond_progress' then
    object_id := (payload->>'id')::uuid;
    select * into r from public.progress_requests where id=object_id for update;
    if r.id is null or r.assignee_member_id<>actor.id or not private.can_project(r.project_id) or (r.task_id is not null and not private.can_work_on_task(r.task_id)) then raise exception '담당자만 응답할 수 있습니다.' using errcode='42501'; end if;
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

create or replace function public.reorder_projects(p_ids uuid[], p_previous uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); current_order uuid[];
begin
  if actor.id is null or actor.role not in ('admin','deputy') then raise exception '관리자만 프로젝트 순서를 변경할 수 있습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.workspace_id::text,1));
  select coalesce(array_agg(id order by sort_order,created_at,id),'{}'::uuid[]) into current_order from public.projects where workspace_id=actor.workspace_id and deleted_at is null;
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

create or replace function public.member_activity_report(p_period text,p_anchor date,p_member uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.workspace_members:=private.me(); start_date date; end_date date; start_time timestamptz; end_time timestamptz; entries jsonb; members jsonb; counts jsonb; week_start date; month_start date;
begin
  if actor.id is null or actor.role not in ('admin','deputy') then raise exception '관리자·부관리자만 수행 내역을 조회할 수 있습니다.' using errcode='42501'; end if;
  if p_period is null or p_period not in ('week','month') or p_anchor is null then raise exception '주간 또는 월간과 기준 날짜를 선택하세요.'; end if;
  if p_member is not null and not exists(select 1 from public.workspace_members where id=p_member and workspace_id=actor.workspace_id) then raise exception '같은 연구실의 연구원을 선택하세요.' using errcode='42501'; end if;
  week_start:=date_trunc('week',p_anchor::timestamp)::date;
  month_start:=date_trunc('month',p_anchor::timestamp)::date;
  start_date:=date_trunc(p_period,p_anchor::timestamp)::date;
  end_date:=case when p_period='week' then start_date+7 else (start_date+interval '1 month')::date end;
  start_time:=start_date::timestamp at time zone 'Asia/Seoul';
  end_time:=end_date::timestamp at time zone 'Asia/Seoul';
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'display_name',m.display_name,'role',m.role,'is_active',m.is_active) order by m.display_name,m.id),'[]') into members
    from public.workspace_members m where m.workspace_id=actor.workspace_id and (p_member is null or m.id=p_member);
  -- shortcut: Completion reports reflect current task state; add snapshots if immutable historical reports are required.
  with events as (
    select a.member_id,t.completed_at as occurred_at,jsonb_build_object('kind','completed','id',t.id,'member_id',a.member_id,'task_id',t.id,'task_title',t.title,'project_name',p.name,'occurred_at',t.completed_at,'content',t.description) as entry
    from public.tasks t join public.projects p on p.id=t.project_id
    left join lateral unnest(t.assignee_member_ids) a(member_id) on true
    where p.deleted_at is null and p.workspace_id=actor.workspace_id and t.deleted_at is null and t.status='done' and t.completed_at>=start_time and t.completed_at<end_time
    union all
    select c.author_member_id,c.created_at,jsonb_build_object('kind','comment','id',c.id,'member_id',c.author_member_id,'task_id',t.id,'task_title',t.title,'project_name',p.name,'occurred_at',c.created_at,'content',c.content)
    from public.task_comments c join public.tasks t on t.id=c.task_id join public.projects p on p.id=t.project_id
    where p.deleted_at is null and p.workspace_id=actor.workspace_id and t.deleted_at is null and c.deleted_at is null and c.created_at>=start_time and c.created_at<end_time
    union all
    select r.assignee_member_id,r.responded_at,jsonb_build_object('kind','response','id',r.id,'member_id',r.assignee_member_id,'task_id',r.task_id,'task_title',coalesce(t.title,'프로젝트 진행상황'),'project_name',p.name,'occurred_at',r.responded_at,'content',r.current_work,'blockers',r.blockers,'next_steps',r.next_steps,'estimated_completion_date',r.estimated_completion_date)
    from public.progress_requests r join public.projects p on p.id=r.project_id left join public.tasks t on t.id=r.task_id
    where p.deleted_at is null and p.workspace_id=actor.workspace_id and (r.task_id is null or (t.id is not null and t.deleted_at is null)) and r.responded_at>=start_time and r.responded_at<end_time
  ) select coalesce(jsonb_agg(entry order by occurred_at desc,entry->>'kind',entry->>'id',member_id),'[]') into entries from events where p_member is null or member_id=p_member;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.member_id),'[]') into counts from (
    select a.member_id,
      count(*) filter(where t.status='todo' and t.archived_at is null and p.status='active') as todo,
      count(*) filter(where t.status='ongoing' and t.archived_at is null and p.status='active') as ongoing,
      count(*) filter(where t.status='done' and t.completed_at>=week_start::timestamp at time zone 'Asia/Seoul' and t.completed_at<(week_start+7)::timestamp at time zone 'Asia/Seoul') as week_done,
      count(*) filter(where t.status='done' and t.completed_at>=month_start::timestamp at time zone 'Asia/Seoul' and t.completed_at<(month_start+interval '1 month') at time zone 'Asia/Seoul') as month_done
    from public.tasks t join public.projects p on p.id=t.project_id
    left join lateral unnest(t.assignee_member_ids) a(member_id) on true
    where p.deleted_at is null and p.workspace_id=actor.workspace_id and t.deleted_at is null and (p_member is null or a.member_id=p_member)
    group by a.member_id
  ) c;
  return jsonb_build_object('counts',counts,'week_start',week_start,'week_end',week_start+6,'month_start',month_start,'month_end',(month_start+interval '1 month')::date-1,'start_date',start_date,'end_date',end_date-1,'members',members,'entries',entries);
end $$;
revoke all on function public.member_activity_report(text,date,uuid) from public,anon,authenticated;
grant execute on function public.member_activity_report(text,date,uuid) to authenticated;
