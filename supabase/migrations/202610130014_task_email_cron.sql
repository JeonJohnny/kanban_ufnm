create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create function public.configure_task_email_worker(p_url text,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
  if p_url is null or p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/task-email-worker$'
    or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '잘못된 작업자 설정입니다.'; end if;
  perform pg_advisory_xact_lock(710014);
  select id into secret_id from vault.secrets where name='lab_task_email_worker_url';
  if secret_id is null then perform vault.create_secret(p_url,'lab_task_email_worker_url');
  else perform vault.update_secret(secret_id,p_url); end if;
  select id into secret_id from vault.secrets where name='lab_task_email_worker_token';
  if secret_id is null then perform vault.create_secret(p_token,'lab_task_email_worker_token');
  else perform vault.update_secret(secret_id,p_token); end if;
  return jsonb_build_object('configured',true,'schedule',(select schedule from cron.job where jobname='lab-board-task-email'),'active',(select active from cron.job where jobname='lab-board-task-email'));
end $$;
revoke all on function public.configure_task_email_worker(text,text) from public,anon,authenticated;
grant execute on function public.configure_task_email_worker(text,text) to service_role;

create function private.invoke_task_email_worker() returns void
language plpgsql security definer set search_path='' as $$
declare worker_url text; worker_token text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='lab_task_email_worker_url';
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='lab_task_email_worker_token';
  if worker_url is null or worker_token is null then return; end if;
  perform net.http_post(url:=worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),body:='{}'::jsonb,timeout_milliseconds:=120000);
end $$;
revoke all on function private.invoke_task_email_worker() from public,anon,authenticated;
select cron.schedule('lab-board-task-email','0 * * * *','select private.invoke_task_email_worker()');
