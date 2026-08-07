-- Core tables for ChunithmQueue.
--
-- Everything the app owns lives in the `app` schema so it never collides with
-- the schemas Supabase manages (auth, storage, realtime, public/PostgREST).

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

create table if not exists app.users (
    id              uuid primary key default gen_random_uuid(),

    -- CHUNITHM-NET is the only identity we have: a player is whoever holds a
    -- working token for that account.
    friend_code     text unique,
    display_name    text not null,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

comment on column app.users.friend_code is
    'CHUNITHM-NET friend code. Unique per game account, so it doubles as the natural key.';

-- ---------------------------------------------------------------------------
-- CHUNITHM-NET link
-- ---------------------------------------------------------------------------

create table if not exists app.chunithm_links (
    user_id         uuid primary key references app.users (id) on delete cascade,

    -- AES-256-GCM envelope: base64(iv || auth tag || ciphertext).
    -- Never store this in plaintext: the cookie can rename the player's account
    -- and read everything on their profile.
    cookie_jar      text not null,

    linked_at       timestamptz not null default now(),
    last_used_at    timestamptz,

    -- Set when CHUNITHM-NET rejects the token, so the UI can prompt a relink
    -- instead of failing every request.
    invalidated_at  timestamptz,
    last_error      text
);

create index if not exists chunithm_links_invalidated_idx
    on app.chunithm_links (invalidated_at)
    where invalidated_at is not null;

-- ---------------------------------------------------------------------------
-- Song database
-- ---------------------------------------------------------------------------
-- CHUNITHM-NET does not expose chart constants, but play rating and OVER POWER
-- cannot be computed without them, so they are seeded from a community dataset.

create table if not exists app.songs (
    id                      integer primary key,
    title                   text not null,
    artist                  text not null,
    genre                   text not null,
    version                 text not null,
    release_date            date,

    bpm                     integer,
    min_bpm                 integer,
    max_bpm                 integer,

    jacket                  text,
    duration_ms             integer,

    available               boolean not null default false,
    removed                 boolean not null default false,

    -- SEGA occasionally hides songs from CHUNITHM-NET listings even though
    -- they still count towards rating.
    is_hidden_on_chuninet   boolean not null default false
);

create index if not exists songs_lower_title_idx on app.songs (lower(title));
create index if not exists songs_available_idx on app.songs (available);
create index if not exists songs_jacket_idx on app.songs (jacket);

create table if not exists app.charts (
    song_id     integer not null references app.songs (id) on delete cascade,
    difficulty  text not null check (
                    difficulty in ('BAS', 'ADV', 'EXP', 'MAS', 'ULT', 'WE')
                ),

    level       text not null,
    -- Chart constant, always one decimal place (e.g. 15.6).
    const       numeric(4, 1),

    max_combo   integer,
    tap         integer,
    hold        integer,
    slide       integer,
    air         integer,
    flick       integer,

    charter     text,
    version     text,
    available   boolean not null default false,

    primary key (song_id, difficulty)
);

create index if not exists charts_const_idx on app.charts (const);
create index if not exists charts_level_idx on app.charts (level);

-- ---------------------------------------------------------------------------
-- Arcade locations
-- ---------------------------------------------------------------------------
-- Scraped from location.am-all.net. `sid` is SEGA's own id and stays stable
-- across scrapes, so it is the upsert key.

create table if not exists app.arcades (
    sid             integer primary key,
    name            text not null,
    address         text not null,
    latitude        double precision,
    longitude       double precision,

    -- SEGA publishes no cabinet counts; filled in by an operator later.
    cabinet_count   integer,

    last_seen_at    timestamptz not null default now(),
    created_at      timestamptz not null default now()
);
