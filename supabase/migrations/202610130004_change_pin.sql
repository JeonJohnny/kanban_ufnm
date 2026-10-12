create function public.change_own_pin(p_current_pin text, p_new_pin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members := private.me();
  credentials private.member_pins;
  attempt_count integer;
  limit_key text;
begin
  if actor.id is null then raise exception '다시 로그인한 뒤 PIN을 변경하세요.' using errcode='42501'; end if;
  if p_current_pin is null or p_new_pin is null or p_current_pin !~ '^[0-9]{4}$' or p_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('error','PIN은 숫자 4자리여야 합니다.');
  end if;

  -- Serialize with PIN resets and recheck the session after acquiring the lock.
  select * into credentials from private.member_pins where member_id=actor.id for update;
  if (private.me()).id is null then raise exception '다시 로그인한 뒤 PIN을 변경하세요.' using errcode='42501'; end if;
  limit_key := 'pin-change:'||actor.id::text;
  insert into private.login_limits(key,attempts) values(limit_key,1)
  on conflict(key) do update set
    attempts=case when private.login_limits.started_at<now()-interval '15 minutes' then 1 else private.login_limits.attempts+1 end,
    started_at=case when private.login_limits.started_at<now()-interval '15 minutes' then now() else private.login_limits.started_at end
  returning attempts into attempt_count;
  -- Return failures instead of raising, so failed-attempt counters are committed.
  if attempt_count>5 then return jsonb_build_object('error','PIN 변경 시도가 너무 많습니다. 15분 후 다시 시도하세요.'); end if;
  if extensions.crypt(p_current_pin,credentials.pin_hash) is distinct from credentials.pin_hash then
    return jsonb_build_object('error','현재 PIN이 올바르지 않습니다.');
  end if;
  if p_current_pin=p_new_pin then return jsonb_build_object('error','현재 PIN과 다른 새 PIN을 입력하세요.'); end if;

  update private.member_pins set pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),version=version+1 where member_id=actor.id;
  delete from private.pin_sessions where member_id=actor.id;
  delete from private.login_limits where key in (limit_key,'member:'||actor.id::text);
  return jsonb_build_object('changed',true);
end $$;
revoke all on function public.change_own_pin(text,text) from public,anon,authenticated;
grant execute on function public.change_own_pin(text,text) to authenticated;
