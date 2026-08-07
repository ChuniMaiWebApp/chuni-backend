-- Tracks when the song dataset was last pulled from upstream.
--
-- The dataset is a third-party snapshot: chart constants, notecounts and the
-- availability flag all come from it, and it goes stale silently. Without a
-- record of when it was last refreshed there is no way to tell "this song does
-- not exist" from "our copy predates it" — which is exactly how a song the
-- player had already cleared came to be reported as unplayable.

create table if not exists app.seed_refreshes (
    id            bigint generated always as identity primary key,

    source        text not null,
    -- SHA-256 of the downloaded file, so an unchanged upstream is visible as
    -- such rather than looking like a successful update.
    content_hash  text not null,

    song_count    integer,
    chart_count   integer,

    -- Newest release date present, the most useful staleness signal: a
    -- dataset whose newest song is months old is missing recent releases.
    newest_release date,

    fetched_at    timestamptz not null default now(),
    changed       boolean not null default true
);

create index if not exists seed_refreshes_fetched_at_idx
    on app.seed_refreshes (fetched_at desc);
