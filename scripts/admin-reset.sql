-- Reset someone's /admin authenticator by their sign-in email, for when their phone and their backup codes are
-- both gone. Their authenticator, wrong-code count, pause and backup codes go, every device of theirs locks, and
-- the log says the server did it. They set up a new one the next time they open /admin.
--
--   docker compose -f docker-compose.prod.yml exec -T db psql -U roach -d roach -v email='someone@example.com' < scripts/admin-reset.sql

\set ON_ERROR_STOP on

select count(*) = 1 as found from users where email = lower(trim(:'email')) \gset
\if :found
begin;

update admins
set totp_secret = null, totp_pending = null, totp_confirmed_at = null, totp_last_step = null,
    fails = 0, paused_until = null, pauses = 0, pause_reason = null
where user_id = (select id from users where email = lower(trim(:'email')));

delete from admin_backup_codes where user_id = (select id from users where email = lower(trim(:'email')));

update sessions set admin_until = null, admin_fresh_at = null
where user_id = (select id from users where email = lower(trim(:'email')));

insert into admin_log (actor_alias, kind, what, target_id, detail)
select '服务器', 'admin', 'admin.reset', id, '在服务器上重置了验证器' from users where email = lower(trim(:'email'));

commit;
\echo 'Reset. They set up a new authenticator the next time they open /admin.'
\else
\echo 'No account signs in with that email: nothing changed.'
\endif
