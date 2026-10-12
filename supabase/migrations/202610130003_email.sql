create table private.email_sends (
  request_id uuid primary key,
  member_id uuid not null references public.workspace_members,
  notice_id uuid not null references public.notices,
  fingerprint text not null,
  status text not null default 'sending' check (status in ('sending','sent','failed','unknown')),
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on private.email_sends from public,anon,authenticated;
create index on private.email_sends(member_id,created_at);

create function public.reserve_notice_email(p_request uuid,p_notice uuid,p_to text,p_subject text,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members := private.me();
  previous private.email_sends;
  fingerprint text;
begin
  if actor.id is null or not private.can_notice(p_notice) then raise exception '전달사항에 접근할 권한이 없습니다.' using errcode='42501'; end if;
  if p_request is null or p_to is null or length(p_to)>254 or p_to !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
    or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_subject ~ E'[\r\n]'
    or p_body is null or length(trim(p_body)) not between 1 and 20000 then raise exception '수신 주소, 제목, 본문을 확인하세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text,0));
  fingerprint := encode(extensions.digest(jsonb_build_array(p_notice,p_to,p_subject,p_body)::text,'sha256'),'hex');
  select * into previous from private.email_sends where request_id=p_request;
  if found then
    if previous.member_id<>actor.id or previous.fingerprint<>fingerprint then raise exception '기존 발송 요청과 내용이 다릅니다.' using errcode='42501'; end if;
    return jsonb_build_object('fresh',false,'status',previous.status);
  end if;
  if exists(select 1 from private.email_sends where member_id=actor.id and notice_id=p_notice and status in ('sending','unknown')) then
    raise exception '이 전달사항의 이전 발송 결과를 확인 중입니다. 관리자가 발송 기록을 확인한 뒤 다시 시도하세요.';
  end if;
  if (select count(*) from private.email_sends where member_id=actor.id and created_at>now()-interval '1 hour')>=10 then
    raise exception '메일은 연구원당 1시간에 10건까지 요청할 수 있습니다.';
  end if;
  insert into private.email_sends(request_id,member_id,notice_id,fingerprint) values(p_request,actor.id,p_notice,fingerprint);
  return jsonb_build_object('fresh',true,'status','sending');
end $$;

create function public.finish_notice_email(p_request uuid,p_status text,p_provider_id text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('sent','failed','unknown') or p_status is null then raise exception '잘못된 발송 상태입니다.'; end if;
  if p_status='sent' and coalesce(length(p_provider_id),0)=0 then raise exception '발송 ID가 필요합니다.'; end if;
  update private.email_sends set status=p_status,provider_id=p_provider_id,updated_at=now() where request_id=p_request and status in ('sending','unknown');
end $$;
revoke all on function public.reserve_notice_email(uuid,uuid,text,text,text),public.finish_notice_email(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_notice_email(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.finish_notice_email(uuid,text,text) to service_role;

create function public.notice_email_status(p_request uuid,p_notice uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); state text;
begin
  if actor.id is null or not private.can_notice(p_notice) then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
  select status into state from private.email_sends where request_id=p_request and member_id=actor.id and notice_id=p_notice;
  return jsonb_build_object('status',coalesce(state,'not_found'));
end $$;
revoke all on function public.notice_email_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.notice_email_status(uuid,uuid) to authenticated;
