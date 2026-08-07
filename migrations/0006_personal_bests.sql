-- Locally cached personal bests.
--
-- CHUNITHM-NET has no "give me everything" endpoint: reading a player's whole
-- record set costs one request per difficulty, so folder statistics would be
-- unusable if computed live. Scores are synced here instead and aggregated in
-- SQL.
--
-- Only raw facts are stored — score, lamps, judgements. Play rating and OVER
-- POWER are deliberately NOT stored: they are a function of the chart constant,
-- and constants change when SEGA rebalances a chart. Caching them means a
-- rebalanced chart keeps reporting its old value forever, which is exactly the
-- drift visible in the Discord bot (its cached OVER POWER reads ~57 higher than
-- the game's). Computing them on read from app.charts keeps the two in step.

create table if not exists app.personal_bests (
    user_id             uuid not null references app.users (id) on delete cascade,
    song_id             integer not null,
    difficulty          text not null check (
                            difficulty in ('BAS', 'ADV', 'EXP', 'MAS', 'ULT', 'WE')
                        ),

    score               integer not null,

    clear_lamp          smallint,
    combo_lamp          smallint,
    chain_lamp          smallint,

    justice_critical    integer,
    justice             integer,
    attack              integer,
    miss                integer,
    max_combo           integer,

    -- When this score was set, if CHUNITHM-NET told us. The record lists do
    -- not carry a date, only the playlog does.
    achieved_at         timestamptz,
    -- When we last saw the chart played at all.
    last_played_at      timestamptz,

    synced_at           timestamptz not null default now(),

    primary key (user_id, song_id, difficulty),

    foreign key (song_id, difficulty)
        references app.charts (song_id, difficulty)
        on delete cascade
);

-- The statistics queries all filter by user first, then join charts.
create index if not exists personal_bests_user_idx
    on app.personal_bests (user_id);

create index if not exists personal_bests_chart_idx
    on app.personal_bests (song_id, difficulty);

-- Records the last successful full sync so the UI can say how stale the
-- numbers are without scanning the whole table.
create table if not exists app.sync_runs (
    user_id       uuid primary key references app.users (id) on delete cascade,
    started_at    timestamptz not null,
    finished_at   timestamptz,
    score_count   integer,
    error         text
);
