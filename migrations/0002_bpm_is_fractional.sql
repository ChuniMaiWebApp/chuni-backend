-- BPM is not always a whole number: 58 songs in the dataset have a fractional
-- primary BPM (e.g. 情熱大陸 at 153.884) and 102 have a fractional minimum.
-- Three decimals covers every value present.

alter table app.songs
    alter column bpm     type numeric(8, 3),
    alter column min_bpm type numeric(8, 3),
    alter column max_bpm type numeric(8, 3);
