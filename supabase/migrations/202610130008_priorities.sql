-- Keep the existing normal/high values for compatibility; retire low as no priority.
update public.tasks set priority='normal',revision=revision+1,updated_at=now() where priority='low';
alter table public.tasks drop constraint tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (priority in ('normal','high','urgent'));
