alter table public.workspace_members add column email text;
alter table public.workspace_members add constraint member_email_format check (
  email is null or (length(email)<=254 and email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$')
);

create function public.save_member_email(p_email text, p_member uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members := private.me(); target uuid;
begin
  if actor.id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  target := coalesce(p_member,actor.id);
  if target<>actor.id and actor.role<>'admin' then raise exception '본인의 이메일만 변경할 수 있습니다.' using errcode='42501'; end if;
  update public.workspace_members set email=nullif(trim(p_email),'') where id=target and workspace_id=actor.workspace_id;
  if not found then raise exception '연구원을 찾을 수 없습니다.' using errcode='42501'; end if;
  return jsonb_build_object('id',target);
end $$;
revoke all on function public.save_member_email(text,uuid) from public,anon,authenticated;
grant execute on function public.save_member_email(text,uuid) to authenticated;


drop function public.admin_save_member(uuid,uuid,uuid,text,text,uuid,text);
create function public.admin_save_member(p_actor uuid,p_session uuid,p_user uuid,p_name text,p_pin text,p_member uuid default null,p_workspace_name text default '우리 연구실',p_email text default null) returns uuid
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
    insert into public.workspace_members(workspace_id,auth_user_id,display_name,email,role) values(workspace,p_user,trim(p_name),nullif(trim(p_email),''),case when p_actor is null then 'admin' else 'member' end) returning id into result;
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
revoke all on function public.admin_save_member(uuid,uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_save_member(uuid,uuid,uuid,text,text,uuid,text,text) to service_role;
