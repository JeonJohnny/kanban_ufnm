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
    where p.workspace_id=actor.workspace_id and t.deleted_at is null and t.status='done' and t.completed_at>=start_time and t.completed_at<end_time
    union all
    select c.author_member_id,c.created_at,jsonb_build_object('kind','comment','id',c.id,'member_id',c.author_member_id,'task_id',t.id,'task_title',t.title,'project_name',p.name,'occurred_at',c.created_at,'content',c.content)
    from public.task_comments c join public.tasks t on t.id=c.task_id join public.projects p on p.id=t.project_id
    where p.workspace_id=actor.workspace_id and t.deleted_at is null and c.deleted_at is null and c.created_at>=start_time and c.created_at<end_time
    union all
    select r.assignee_member_id,r.responded_at,jsonb_build_object('kind','response','id',r.id,'member_id',r.assignee_member_id,'task_id',r.task_id,'task_title',coalesce(t.title,'프로젝트 진행상황'),'project_name',p.name,'occurred_at',r.responded_at,'content',r.current_work,'blockers',r.blockers,'next_steps',r.next_steps,'estimated_completion_date',r.estimated_completion_date)
    from public.progress_requests r join public.projects p on p.id=r.project_id left join public.tasks t on t.id=r.task_id
    where p.workspace_id=actor.workspace_id and (r.task_id is null or (t.id is not null and t.deleted_at is null)) and r.responded_at>=start_time and r.responded_at<end_time
  ) select coalesce(jsonb_agg(entry order by occurred_at desc,entry->>'kind',entry->>'id',member_id),'[]') into entries from events where p_member is null or member_id=p_member;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into counts from (
    select a.member_id,
      count(*) filter(where t.status='todo' and t.archived_at is null and p.status='active') as todo,
      count(*) filter(where t.status='ongoing' and t.archived_at is null and p.status='active') as ongoing,
      count(*) filter(where t.status='done' and t.completed_at>=week_start::timestamp at time zone 'Asia/Seoul' and t.completed_at<(week_start+7)::timestamp at time zone 'Asia/Seoul') as week_done,
      count(*) filter(where t.status='done' and t.completed_at>=month_start::timestamp at time zone 'Asia/Seoul' and t.completed_at<(month_start+interval '1 month') at time zone 'Asia/Seoul') as month_done
    from public.tasks t join public.projects p on p.id=t.project_id
    left join lateral unnest(t.assignee_member_ids) a(member_id) on true
    where p.workspace_id=actor.workspace_id and t.deleted_at is null and (p_member is null or a.member_id=p_member)
    group by a.member_id
  ) c;
  return jsonb_build_object('counts',counts,'week_start',week_start,'week_end',week_start+6,'month_start',month_start,'month_end',(month_start+interval '1 month')::date-1,'start_date',start_date,'end_date',end_date-1,'members',members,'entries',entries);
end $$;
revoke all on function public.member_activity_report(text,date,uuid) from public,anon,authenticated;
grant execute on function public.member_activity_report(text,date,uuid) to authenticated;
