-- Some charts genuinely spike into absurd tempos as a gag — PRIVATE SERVICE
-- peaks at 123001.547 BPM and だんだん早くなる ("gradually gets faster") at
-- 10240. numeric(8,3) tops out at 99999.999, so widen it.

alter table app.songs
    alter column bpm     type numeric(10, 3),
    alter column min_bpm type numeric(10, 3),
    alter column max_bpm type numeric(10, 3);
