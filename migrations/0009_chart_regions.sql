-- Replaces 0008's approach with a single source that already answers the
-- question, per chart.
--
-- 0008 tried to reconstruct International availability from three signals:
-- SEGA's International music list, SEGA's Japanese one, and a live probe of
-- the International jacket CDN. That worked, but it was reconstruction. Two
-- of those sources are periodic snapshots (the International list read on
-- 2026-08-07 was published 2026-04-09), and none of them lists songs that are
-- unlocked through missions or Linked VERSE gates — which is precisely why
-- Phantom Crisis and Melodiniq were absent from both.
--
-- arcade-songs (zetaraku) already merges those sources and publishes a
-- per-chart `regions: { jp, intl }`, refreshed daily. Checked against this
-- installation's real play data:
--
--     432 / 432 songs the player has cleared  -> intl = true
--     516 / 516 charts the player has cleared -> intl = true
--     Melodiniq      -> intl = false on every chart   (matches the game)
--     Phantom Crisis -> intl = true  on every chart   (matches the game)
--
-- Not one disagreement, including on the 97 songs both official lists miss.
-- So the reconstructed signals are dropped rather than kept as a second
-- opinion that can only ever add noise.
--
-- Per chart, not per song: five songs ship on International without their
-- ULTIMA, and one WORLD'S END song ships only one of its two charts.

alter table app.songs
    drop column if exists listed_intl,
    drop column if exists listed_jp,
    drop column if exists jacket_intl_ok,
    drop column if exists jacket_intl_checked_at;

drop index if exists app.songs_intl_recheck_idx;

-- null = the upstream dataset has no entry for this chart, which is not the
-- same as "the chart is not in that region". Removed songs are the bulk of it.
alter table app.charts
    add column if not exists available_intl boolean,
    add column if not exists available_jp boolean;

-- Song level is derived from the charts: a song is in a region when any of its
-- charts is. Stored rather than computed so search can filter on it cheaply.
alter table app.songs
    add column if not exists available_intl boolean,
    add column if not exists available_jp boolean;

create index if not exists songs_available_intl_idx
    on app.songs (available_intl)
    where removed = false;

drop table if exists app.region_refreshes;

-- Dates the claim. "Not on International" is only honest alongside when the
-- data saying so was published.
create table if not exists app.region_refreshes (
    id              bigint generated always as identity primary key,

    source_url      text not null,
    -- The upstream's own update timestamp, not ours: fetching a stale file
    -- today does not make its contents current.
    published_at    timestamptz,
    fetched_at      timestamptz not null default now(),

    song_count      integer not null,
    matched_songs   integer not null,
    unmatched_songs integer not null
);

create index if not exists region_refreshes_fetched_at_idx
    on app.region_refreshes (fetched_at desc);
