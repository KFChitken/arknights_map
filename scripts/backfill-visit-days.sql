-- Fill in users.visit_days (on how many Beijing dates each player came) for the days before it was kept. Each player's
-- days are the Beijing dates on which they did something themselves: touches, declarations and reactions they sent,
-- their roaches put down, moved or taken back, their notes to 触须之交 and pokes, their touches of the guides, their
-- 寻访 draws, and the day of their last visit. Days they only looked are missed, so it is a little low, never high.
-- It only ever raises the number (greatest), so running it again, early or late, never counts a day twice.
-- 2,000 players at a time, each batch its own transaction, with a short pause between.
--
--   docker compose -f docker-compose.prod.yml exec -T db psql -U roach -d roach < scripts/backfill-visit-days.sql

\set ON_ERROR_STOP on

do $$
declare
  after uuid := '00000000-0000-0000-0000-000000000000';
  batch uuid[];
  players int := 0;
  raised int := 0;
  n int;
begin
  loop
    select array_agg(id order by id) into batch from (select id from users where id > after order by id limit 2000) b;
    exit when batch is null;
    with days as (
      select from_user_id as user_id, (created_at at time zone 'Asia/Shanghai')::date as d from touches where from_user_id = any(batch)
      union
      select sender_id, (created_at at time zone 'Asia/Shanghai')::date from declarations where sender_id = any(batch)
      union
      select from_user_id, (created_at at time zone 'Asia/Shanghai')::date from declaration_reactions where from_user_id = any(batch)
      union
      select user_id, (at at time zone 'Asia/Shanghai')::date from moves where user_id = any(batch)
      union
      select from_user_id, (created_at at time zone 'Asia/Shanghai')::date from friend_notes where from_user_id = any(batch)
      union
      select from_user_id, (created_at at time zone 'Asia/Shanghai')::date from pokes where from_user_id = any(batch)
      union
      select user_id, (created_at at time zone 'Asia/Shanghai')::date from amiya_touches where user_id = any(batch) and direction like 'to\_%'
      union
      select user_id, (created_at at time zone 'Asia/Shanghai')::date from perlica_touches where user_id = any(batch) and direction like 'to\_%'
      union
      select user_id, (created_at at time zone 'Asia/Shanghai')::date from talulah_touches where user_id = any(batch) and direction like 'to\_%'
      union
      select user_id, (created_at at time zone 'Asia/Shanghai')::date from minghe_touches where user_id = any(batch) and direction like 'to\_%'
      union
      select user_id, (created_at at time zone 'Asia/Shanghai')::date from si_touches where user_id = any(batch) and direction like 'to\_%'
      union
      select user_id, (drawn_at at time zone 'Asia/Shanghai')::date from passes where user_id = any(batch)
      union
      select id, last_seen_on from users where id = any(batch) and last_seen_on is not null
    ),
    counted as (select user_id, count(*)::int as days from days group by user_id)
    update users set visit_days = counted.days from counted where users.id = counted.user_id and users.visit_days < counted.days;
    get diagnostics n = row_count;
    raised := raised + n;
    players := players + array_length(batch, 1);
    after := batch[array_length(batch, 1)];
    commit;
    perform pg_sleep(0.2);
  end loop;
  raise notice 'visit days: looked at % players, raised % of them', players, raised;
end $$;
