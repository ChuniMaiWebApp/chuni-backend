-- `app.songs.version` becomes optional.
--
-- The catalogue now loads from SEGA's own music list plus chunirec, and
-- neither publishes the CHUNITHM version a song was added in. SEGA's list has
-- id, title, artist, genre, jacket, reading, per-difficulty level and the
-- WORLD'S END markings, and stops there; chunirec adds the chart constant,
-- BPM, release date and note totals. No version field in either.
--
-- Deriving it from the release date was tried and does not work. Measured
-- against the 2,263 songs already carrying both fields, the version ranges
-- overlap far too much to invert:
--
--     CHUNITHM       2015-07-16 .. 2022-01-06
--     X-VERSE        2016-02-04 .. 2025-11-27
--     LUMINOUS PLUS  2016-09-21 .. 2024-11-28
--
-- A song's release date is when the music came out, which is not when the
-- game gained it. Guessing from that would mislabel hundreds of songs, and a
-- wrong version is worse than a missing one: the songs page filters on it, so
-- a bad value hides a song from the filter that should find it while showing
-- it under one that should not.
--
-- Songs already loaded keep the version they have — the catalogue refresh
-- names only the columns its sources actually know about, so this column is
-- never overwritten. Only songs first seen after this migration arrive
-- without one, and they read as "unknown" rather than as a wrong era.

alter table app.songs
    alter column version drop not null;

comment on column app.songs.version is
    'CHUNITHM version the song was added in. Null for songs added since the '
    'catalogue moved to SEGA + chunirec, neither of which publishes it.';
