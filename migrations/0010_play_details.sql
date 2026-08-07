-- Keeps judgement breakdowns after CHUNITHM-NET has forgotten them.
--
-- CHUNITHM-NET publishes judgements on exactly one page: the detail view of a
-- playlog entry. The music record pages carry none — measured on this
-- installation, 0 of 516 stored personal bests have a judgement count. And the
-- playlog holds only the last 50 tracks, so the breakdown for a personal best
-- is destroyed by simply playing another fifty credits.
--
-- That is a property of SEGA's service, not of the data: the numbers exist
-- while the play is in the window. Writing them down as they go past turns
-- "your last 50 tracks" into "everything seen since this app started
-- watching", which is the difference between a bot answering one command and
-- something with a database behind it.
--
-- Nothing here can recover a record set before the app first saw it. That is
-- unrecoverable — SEGA does not serve it anywhere.

create table if not exists app.play_details (
    user_id           uuid not null references app.users (id) on delete cascade,
    song_id           integer not null,
    difficulty        text not null check (
                          difficulty in ('BAS', 'ADV', 'EXP', 'MAS', 'ULT', 'WE')
                      ),

    -- Part of the key, not just a column: a chart played twice keeps both
    -- runs, and re-capturing the same run is a no-op rather than a duplicate.
    score             integer not null,

    justice_critical  integer not null,
    justice           integer not null,
    attack            integer not null,
    miss              integer not null,
    max_combo         integer,

    -- Note accuracy runs past 100% on JUSTICE CRITICAL, so this is not a
    -- percentage constrained to 0-100.
    pct_tap           numeric(6, 2),
    pct_hold          numeric(6, 2),
    pct_slide         numeric(6, 2),
    pct_air           numeric(6, 2),
    pct_flick         numeric(6, 2),

    achieved_at       timestamptz,
    captured_at       timestamptz not null default now(),

    primary key (user_id, song_id, difficulty, score)
);

-- The lookup the chart detail page makes: best captured run on one chart.
create index if not exists play_details_chart_idx
    on app.play_details (user_id, song_id, difficulty, score desc);
