create table private.task_email_settings (
  workspace_id uuid primary key references public.workspaces,
  enabled boolean not null default true,
  start_hour integer not null default 9 check(start_hour between 0 and 23),
  end_hour integer not null default 18 check(end_hour between 0 and 23),
  check(start_hour<=end_hour)
);
create table private.task_email_batches (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.workspace_members,
  slot timestamptz not null,
  status text not null default 'sending' check(status in ('sending','sent','failed','unknown')),
  provider_id text,
  updated_at timestamptz not null default now(),
  unique(member_id,slot)
);
create table private.task_email_queue (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks,
  member_id uuid not null references public.workspace_members,
  revision integer not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','unknown','cancelled')),
  batch_id uuid references private.task_email_batches,
  unique(task_id,member_id,revision)
);
create index task_email_pending on private.task_email_queue(created_at,member_id) where status='pending';
revoke all on private.task_email_settings,private.task_email_batches,private.task_email_queue from public,anon,authenticated;

create function private.queue_task_assignment_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous uuid[] := '{}';
begin
  if tg_op='UPDATE' then previous:=old.assignee_member_ids; end if;
  update private.task_email_queue set status='cancelled' where task_id=new.id and status='pending'
    and (new.deleted_at is not null or new.archived_at is not null or not(member_id=any(new.assignee_member_ids)));
  if new.deleted_at is null and new.archived_at is null then
    insert into private.task_email_queue(task_id,member_id,revision)
      select new.id,m,new.revision from unnest(new.assignee_member_ids) m where not(m=any(previous))
      on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.queue_task_assignment_email() from public,anon,authenticated;
create trigger queue_task_assignment_email after insert or update of assignee_member_ids,deleted_at,archived_at on public.tasks
  for each row execute function private.queue_task_assignment_email();

create function public.task_email_settings(p_enabled boolean default null,p_start_hour integer default null,p_end_hour integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members:=private.me(); config private.task_email_settings; stats jsonb;
begin
  if actor.id is null or actor.role<>'admin' then raise exception '관리자만 메일 설정을 관리할 수 있습니다.' using errcode='42501'; end if;
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
revoke all on function public.task_email_settings(boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.task_email_settings(boolean,integer,integer) to authenticated;

-- The worker calls this with server time. Tests supply boundary times without changing the clock.
create function public.claim_task_emails(p_now timestamptz default now()) returns jsonb
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
      and (m.role='admin' or m.id=any(p.member_ids)) and t.deleted_at is null and t.archived_at is null and p.status='active'
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

create function public.finish_task_email(p_batch uuid,p_status text,p_provider_id text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_status is null or p_status not in ('sent','failed','unknown') then raise exception '잘못된 발송 상태입니다.'; end if;
  if p_status='sent' and coalesce(length(p_provider_id),0)=0 then raise exception '발송 ID가 필요합니다.'; end if;
  update private.task_email_batches set status=p_status,provider_id=p_provider_id,updated_at=now() where id=p_batch and status in ('sending','unknown');
  if found then update private.task_email_queue set status=p_status where batch_id=p_batch and status in ('sending','unknown'); end if;
end $$;
revoke all on function public.claim_task_emails(timestamptz),public.finish_task_email(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_task_emails(timestamptz),public.finish_task_email(uuid,text,text) to service_role;
