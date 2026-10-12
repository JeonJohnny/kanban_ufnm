create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces,
  auth_user_id uuid not null unique references auth.users,
  display_name text not null check (length(trim(display_name)) between 1 and 50),
  role text not null default 'member' check (role in ('admin','member')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table private.member_pins (
  member_id uuid primary key references public.workspace_members,
  pin_hash text not null,
  version integer not null default 1
);
create table private.pin_sessions (
  session_id uuid primary key,
  member_id uuid not null references public.workspace_members,
  pin_version integer not null,
  created_at timestamptz not null default now()
);
create table private.login_limits (
  key text primary key,
  started_at timestamptz not null default now(),
  attempts integer not null default 0
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check(length(description) <= 5000),
  color text not null default '#6366f1' check(color ~ '^#[0-9A-Fa-f]{6}$'),
  status text not null default 'active' check(status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces,
  author_member_id uuid not null references public.workspace_members,
  title text not null check(length(trim(title)) between 1 and 200),
  content text not null default '' check(length(content) <= 20000),
  is_important boolean not null default false,
  is_broadcast boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.notice_recipients (
  notice_id uuid not null references public.notices on delete cascade,
  recipient_member_id uuid not null references public.workspace_members,
  read_at timestamptz,
  confirmed_at timestamptz,
  primary key(notice_id,recipient_member_id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  title text not null check(length(trim(title)) between 1 and 200),
  description text not null default '' check(length(description) <= 20000),
  status text not null default 'todo' check(status in ('todo','ongoing','done')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  assignee_member_id uuid references public.workspace_members,
  due_date date,
  position double precision not null default 0 check(position > '-Infinity'::float8 and position < 'Infinity'::float8),
  revision integer not null default 1,
  created_by uuid not null references public.workspace_members,
  source_notice_id uuid references public.notices,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  restored_at timestamptz,
  deleted_at timestamptz
);
create table public.task_activities (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks,
  actor_member_id uuid references public.workspace_members,
  event_type text not null,
  created_at timestamptz not null default now()
);
create table public.progress_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  task_id uuid references public.tasks,
  requester_member_id uuid not null references public.workspace_members,
  assignee_member_id uuid not null references public.workspace_members,
  current_work text check(length(current_work) <= 10000),
  blockers text check(length(blockers) <= 10000),
  next_steps text check(length(next_steps) <= 10000),
  estimated_completion_date date,
  requested_at timestamptz not null default now(),
  responded_at timestamptz
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_member_id uuid not null references public.workspace_members,
  event_type text not null check(event_type in ('notice','progress_request','progress_response')),
  related_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.workspace_members(workspace_id);
create index on private.pin_sessions(member_id);
create index on public.projects(workspace_id);
create index on public.tasks(project_id,status,position);
create index on public.tasks(completed_at) where status='done' and archived_at is null and deleted_at is null;
create index on public.notices(workspace_id,created_at desc);
create index on public.notice_recipients(recipient_member_id);
create index on public.progress_requests(project_id);
create index on public.notifications(recipient_member_id,created_at desc);
create index on public.task_activities(task_id);

-- A valid Auth JWT alone cannot bypass PIN login; only PIN-authorized sessions can read data.
create function private.me() returns public.workspace_members
language sql stable security definer set search_path='' as $$
  select m from public.workspace_members m
  join private.member_pins p on p.member_id=m.id
  join private.pin_sessions s on s.member_id=m.id and s.pin_version=p.version
  where m.auth_user_id=auth.uid() and m.is_active
    and s.session_id=(auth.jwt()->>'session_id')::uuid
$$;
create function private.can_project(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects where id=p_id and workspace_id=(private.me()).workspace_id)
$$;
create function private.can_notice(n_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.notices n where n.id=n_id and n.workspace_id=(private.me()).workspace_id
    and (n.is_broadcast or n.author_member_id=(private.me()).id or exists(
      select 1 from public.notice_recipients r where r.notice_id=n.id and r.recipient_member_id=(private.me()).id)))
$$;
grant usage on schema private to authenticated;
grant execute on function private.me(), private.can_project(uuid), private.can_notice(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_activities enable row level security;
alter table public.notices enable row level security;
alter table public.notice_recipients enable row level security;
alter table public.progress_requests enable row level security;
alter table public.notifications enable row level security;
create policy member_read on public.workspaces for select to authenticated using (id=(select (private.me()).workspace_id));
create policy member_read on public.workspace_members for select to authenticated using (workspace_id=(select (private.me()).workspace_id));
create policy member_read on public.projects for select to authenticated using (workspace_id=(select (private.me()).workspace_id));
create policy member_read on public.tasks for select to authenticated using (private.can_project(project_id) and (deleted_at is null or (select (private.me()).role)='admin'));
create policy member_read on public.task_activities for select to authenticated using (exists(select 1 from public.tasks t where t.id=task_id));
create policy recipient_read on public.notices for select to authenticated using (private.can_notice(id));
create policy recipient_read on public.notice_recipients for select to authenticated using (private.can_notice(notice_id));
create policy member_read on public.progress_requests for select to authenticated using (private.can_project(project_id));
create policy recipient_read on public.notifications for select to authenticated using (recipient_member_id=(select (private.me()).id));
revoke all on public.workspaces,public.workspace_members,public.projects,public.tasks,public.task_activities,public.notices,public.notice_recipients,public.progress_requests,public.notifications from anon,authenticated;
grant select on public.workspaces,public.workspace_members,public.projects,public.tasks,public.task_activities,public.notices,public.notice_recipients,public.progress_requests,public.notifications to authenticated;

create function public.current_member() returns jsonb
language sql stable security definer set search_path='' as $$ select to_jsonb(private.me()) $$;

-- All mutations pass through this function: clients never get direct table write privileges.
create function public.board_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
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
      if t.id is null or not private.can_project(t.project_id) then raise exception '접근할 수 없는 태스크입니다.' using errcode='42501'; end if;
      if t.revision is distinct from (payload->>'revision')::integer then raise exception '다른 사용자가 수정했습니다. 새로 불러온 내용을 확인하세요.' using errcode='40001'; end if;
      if t.deleted_at is not null and (action<>'restore_task' or actor.role<>'admin') then raise exception '삭제된 태스크입니다.' using errcode='42501'; end if;
      project := t.project_id;
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
          update public.tasks set title=trim(payload->>'title'),description=coalesce(payload->>'description',''),status=next_status,priority=payload->>'priority',assignee_member_id=assignee,due_date=nullif(payload->>'due_date','')::date,
            completed_at=case when next_status='done' then coalesce(completed_at,now()) else null end,
            restored_at=case when next_status='done' then restored_at else null end,updated_at=now(),revision=revision+1 where id=object_id;
        end if;
      end if;
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
    select * into t from public.tasks where id=(payload->>'task_id')::uuid;
    if t.id is null or not private.can_project(t.project_id) or t.deleted_at is not null or t.assignee_member_id is null then raise exception '담당자가 있는 태스크를 선택하세요.'; end if;
    if not exists(select 1 from public.workspace_members where id=t.assignee_member_id and is_active) then raise exception '비활성 담당자입니다.'; end if;
    insert into public.progress_requests(project_id,task_id,requester_member_id,assignee_member_id) values(t.project_id,t.id,actor.id,t.assignee_member_id) returning id into object_id;
    insert into public.notifications(recipient_member_id,event_type,related_id) values(t.assignee_member_id,'progress_request',object_id);
  elsif action='respond_progress' then
    object_id := (payload->>'id')::uuid;
    select * into r from public.progress_requests where id=object_id for update;
    if r.id is null or r.assignee_member_id<>actor.id or not private.can_project(r.project_id) then raise exception '담당자만 응답할 수 있습니다.' using errcode='42501'; end if;
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

-- Limits are committed even on bad credentials; no exception rolls back the counter.
create function public.pin_check(p_member uuid, p_pin text, p_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k text; count integer; blocked boolean := false; credentials private.member_pins; member public.workspace_members;
begin
  foreach k in array array['origin:'||left(p_origin,128),'member:'||p_member::text] loop
    insert into private.login_limits(key,attempts) values(k,1)
    on conflict(key) do update set
      attempts=case when private.login_limits.started_at<now()-interval '15 minutes' then 1 else private.login_limits.attempts+1 end,
      started_at=case when private.login_limits.started_at<now()-interval '15 minutes' then now() else private.login_limits.started_at end
    returning attempts into count;
    if count > (case when k like 'origin:%' then 40 else 5 end) then blocked:=true; end if;
  end loop;
  if blocked then return jsonb_build_object('error','잠시 후 다시 시도하세요. 로그인은 15분 동안 제한됩니다.'); end if;
  select * into member from public.workspace_members where id=p_member and is_active;
  select * into credentials from private.member_pins where member_id=p_member;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or member.id is null or credentials.member_id is null or extensions.crypt(p_pin,credentials.pin_hash)<>credentials.pin_hash then
    return jsonb_build_object('error','이름과 PIN을 확인하세요.');
  end if;
  return jsonb_build_object('auth_user_id',member.auth_user_id,'version',credentials.version);
end $$;
create function public.pin_register_session(p_member uuid,p_session uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from private.member_pins where member_id=p_member and version=p_version for update;
  if not found then raise exception 'PIN이 변경되었습니다. 다시 로그인하세요.'; end if;
  if not exists(select 1 from auth.sessions s join public.workspace_members m on m.auth_user_id=s.user_id where s.id=p_session and m.id=p_member and m.is_active) then raise exception '잘못된 세션입니다.'; end if;
  insert into private.pin_sessions(session_id,member_id,pin_version) values(p_session,p_member,p_version);
end $$;
create function public.login_roster() returns table(id uuid,display_name text)
language sql stable security definer set search_path='' as $$ select id,display_name from public.workspace_members where is_active order by display_name $$;

create function public.admin_save_member(p_actor uuid,p_session uuid,p_user uuid,p_name text,p_pin text,p_member uuid default null,p_workspace_name text default '우리 연구실') returns uuid
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
    where m.auth_user_id=p_actor and m.role='admin' and m.is_active and s.session_id=p_session;
    if administrator.id is null then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
    workspace:=administrator.workspace_id;
  end if;
  if p_member is null then
    insert into public.workspace_members(workspace_id,auth_user_id,display_name,role) values(workspace,p_user,trim(p_name),case when p_actor is null then 'admin' else 'member' end) returning id into result;
    insert into private.member_pins(member_id,pin_hash) values(result,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
  else
    select id into result from public.workspace_members where id=p_member and workspace_id=workspace;
    if result is null then raise exception '연구원을 찾을 수 없습니다.'; end if;
    update private.member_pins set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),version=version+1 where member_id=result;
    delete from private.pin_sessions where member_id=result;
    delete from private.login_limits where key='member:'||result::text;
  end if;
  return result;
end $$;

create function private.archive_done() returns void language plpgsql security definer set search_path='' as $$
begin
  with moved as (
    update public.tasks set archived_at=now(),updated_at=now(),revision=revision+1
    where status='done' and deleted_at is null and archived_at is null
      and greatest(completed_at,restored_at)<now()-interval '30 days'
    returning id
  ) insert into public.task_activities(task_id,event_type) select id,'auto_archive' from moved;
  delete from private.login_limits where started_at<now()-interval '1 day';
  delete from private.pin_sessions s where not exists(select 1 from auth.sessions a where a.id=s.session_id);
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.me(),private.can_project(uuid),private.can_notice(uuid) to authenticated;
revoke all on function public.current_member(),public.board_action(text,jsonb),public.pin_check(uuid,text,text),public.pin_register_session(uuid,uuid,integer),public.login_roster(),public.admin_save_member(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.current_member(),public.board_action(text,jsonb) to authenticated;
grant execute on function public.pin_check(uuid,text,text),public.pin_register_session(uuid,uuid,integer),public.login_roster(),public.admin_save_member(uuid,uuid,uuid,text,text,uuid,text) to service_role;

alter publication supabase_realtime add table public.projects,public.tasks,public.notices,public.notice_recipients,public.progress_requests,public.notifications,public.workspace_members;
