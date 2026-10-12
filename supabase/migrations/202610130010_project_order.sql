alter table public.projects add column sort_order integer not null default 2147483647;
with ranked as (
  select id,row_number() over(partition by workspace_id order by id)::integer as position from public.projects
)
update public.projects p set sort_order=r.position from ranked r where r.id=p.id;

create function public.reorder_projects(p_ids uuid[], p_previous uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); current_order uuid[];
begin
  if actor.id is null or actor.role<>'admin' then raise exception '관리자만 프로젝트 순서를 변경할 수 있습니다.' using errcode='42501'; end if;
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
revoke all on function public.reorder_projects(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_projects(uuid[],uuid[]) to authenticated;
