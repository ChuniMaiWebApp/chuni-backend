-- Regional availability moves from the song to the chart.
--
-- 0008 recorded it per song and reconstructed it from indirect signals: the
-- two published music lists plus a live probe of the International jacket CDN.
-- Both of those assumptions turned out to be wrong.
--
-- Wrong shape: availability is a property of the chart, not the song. Five
-- songs ship on International without their ULTIMA, and one WORLD'S END song
-- ships only one of its two charts. Per song there is no way to say that.
--
-- Wrong signals: a published music list is a snapshot — the International one
-- read on 2026-08-07 had been published on 2026-04-09 — and neither regional
-- list includes songs unlocked through a mission or a Linked VERSE gate, which
-- is why Phantom Crisis and Melodiniq were missing from both. A song a player
-- can sit down and play is not "unavailable" because a static page has not
-- caught up.
--
-- So the columns below are written from what each region itself reports, and
-- the indirect signals are dropped rather than kept as a second opinion that
-- can only add noise. Which sources those are is the application's business
-- and has changed since; see AvailabilityRefreshService.
--
-- Whatever fills them, the acceptance test does not change: every chart this
-- installation's players have actually cleared must come back marked
-- available on International, and songs known to be Japan-only must not.

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
