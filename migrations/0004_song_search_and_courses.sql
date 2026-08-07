-- Song search, chart view links, and the course list.

-- Song titles are a mix of Japanese, English and symbols, and players type
-- approximate romanisations ("tentai kansoku" for 天体観測). Full-text search
-- with an English dictionary is useless for that; trigram similarity works on
-- any script and tolerates typos, which is what the Discord bot achieves with
-- in-memory fuzzy matching.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Aliases
-- ---------------------------------------------------------------------------

create table if not exists app.song_aliases (
    id          bigint generated always as identity primary key,
    song_id     integer not null references app.songs (id) on delete cascade,
    alias       text not null,

    -- Where the alias came from, so community additions can be told apart from
    -- the seeded set and reseeding does not wipe them.
    source      text not null default 'seed' check (source in ('seed', 'user')),
    created_at  timestamptz not null default now(),

    unique (song_id, alias)
);

-- Postgres does not index foreign keys automatically, and this one is joined
-- on every search.
create index if not exists song_aliases_song_id_idx
    on app.song_aliases (song_id);

create index if not exists song_aliases_alias_trgm_idx
    on app.song_aliases using gin (lower(alias) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Search indexes on songs
-- ---------------------------------------------------------------------------

create index if not exists songs_title_trgm_idx
    on app.songs using gin (lower(title) gin_trgm_ops);

create index if not exists songs_artist_trgm_idx
    on app.songs using gin (lower(artist) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- sdvx.in chart views
-- ---------------------------------------------------------------------------
-- Kept on the chart row rather than in a side table: it is a 1:1 attribute and
-- every read that wants it already has the chart.

alter table app.charts
    add column if not exists sdvxin_id text,
    add column if not exists sdvxin_end_index text;

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------

create table if not exists app.courses (
    id                          integer primary key,
    class                       text not null,
    name                        text not null,
    version                     text not null,

    is_duplicate_track_allowed  boolean not null default true,

    -- Gauge rules, used to explain how punishing a course is.
    life                        integer,
    recovery_life               integer,
    clear_life                  integer,
    damage_miss                 integer,
    damage_attack               integer,
    damage_justice              integer,
    damage_jcrit                integer
);

create table if not exists app.course_tracks (
    course_id   integer not null references app.courses (id) on delete cascade,
    position    smallint not null,
    song_id     integer not null references app.songs (id) on delete cascade,
    difficulty  text not null check (
                    difficulty in ('BAS', 'ADV', 'EXP', 'MAS', 'ULT', 'WE')
                ),

    primary key (course_id, position)
);

create index if not exists course_tracks_song_id_idx
    on app.course_tracks (song_id);
