-- Records whether a song is playable on CHUNITHM International, from sources
-- that actually distinguish International from Japan.
--
-- Background. The seeded `songs.available` flag is a third-party snapshot and
-- is wrong in both directions: it called 120 songs available that SEGA's
-- International site does not list, and called Phantom Crisis unavailable
-- while the player had already cleared it. Player scores prove a song IS
-- playable but can never prove the opposite, and only cover a fifth of the
-- catalogue — so "nobody here has played it" is not evidence of anything.
--
-- Three better sources, in the order they are trusted:
--
--   1. jacket_intl_status — whether SEGA's International CDN serves the song's
--      jacket. Live infrastructure, not a dump. Verified against 109 songs
--      known to be playable (including 97 that BOTH snapshots below miss):
--      109/109 correct, with no false positives among 95 known JP-only songs.
--   2. listed_intl — present in chunithm.sega.com's music list. Authoritative
--      but a periodic snapshot; the copy read on 2026-08-07 was published
--      2026-04-09, so it is a lower bound, never a refutation.
--   3. listed_jp — present in chunithm.sega.jp's music list, which is
--      refreshed constantly. Lets "not on International yet" be stated as the
--      sourced fact it is rather than as a guess.

alter table app.songs
    -- null = never looked, distinct from "looked and it was absent".
    add column if not exists listed_intl boolean,
    add column if not exists listed_jp boolean,

    -- 200 / 404 from the International jacket CDN. Null until probed.
    add column if not exists jacket_intl_ok boolean,
    add column if not exists jacket_intl_checked_at timestamptz;

-- Songs believed unavailable get re-probed on a timer, so a song that reaches
-- International stops being reported as missing without waiting for a reseed.
create index if not exists songs_intl_recheck_idx
    on app.songs (jacket_intl_checked_at)
    where jacket_intl_ok is not true and removed = false;

-- When each regional list was last pulled, so the UI can date its claims
-- instead of asserting them flatly.
create table if not exists app.region_refreshes (
    id           bigint generated always as identity primary key,

    -- 'intl' or 'jp'.
    region       text not null check (region in ('intl', 'jp')),
    source_url   text not null,

    -- The upstream file's own Last-Modified, which is the number that matters:
    -- fetching a four-month-old file today does not make it current.
    published_at timestamptz,
    fetched_at   timestamptz not null default now(),

    song_count   integer not null
);

create index if not exists region_refreshes_region_idx
    on app.region_refreshes (region, fetched_at desc);
