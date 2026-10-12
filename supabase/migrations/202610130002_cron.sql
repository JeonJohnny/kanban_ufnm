create extension if not exists pg_cron;
select cron.schedule('lab-board-archive-done','17 * * * *','select private.archive_done()');
