-- Not every course track names a chart.
--
-- The "Random" class courses (e.g. クラス認定 - I - Random) specify only a level,
-- such as {"level": "10+"}, and the cabinet picks a chart at play time. 44 of
-- the 330 seeded tracks are like this.

alter table app.course_tracks
    alter column song_id drop not null,
    alter column difficulty drop not null;

alter table app.course_tracks
    add column if not exists level text;

-- A track is either a fixed chart or a random pick from a level, never both
-- and never neither.
alter table app.course_tracks
    drop constraint if exists course_tracks_fixed_or_random;

alter table app.course_tracks
    add constraint course_tracks_fixed_or_random check (
        (song_id is not null and difficulty is not null and level is null)
        or (song_id is null and difficulty is null and level is not null)
    );
