-- Linked GATE badge meanings move from a bundled table into the database.
--
-- CHUNITHM-NET draws each gate's progress as a hexagon served under an opaque
-- filename, with nothing in the DOM saying which state it represents. Reading
-- the page gives you `Y9BRPL5DR4EDEOH06QV5OUPD2WYFF14I.png` and no more, so
-- turning that into "cleared" needs a lookup somebody has filled in by hand.
--
-- As a source file that lookup could only be extended by editing code and
-- redeploying, which is the wrong shape for it: SEGA adds a gate every version,
-- and the badge is unrecognised until someone notices and ships a patch. It
-- also cannot be filled in by the one person who actually knows the answer —
-- the player looking at their own gate.
--
-- Here instead. The parser records any badge it does not recognise, and the
-- meaning is filled in once, from Studio, by whoever can see what the hexagon
-- says. Unknown stays unknown until then, which is the honest reading: an
-- unrecognised badge is a gap in this table, not a statement that the player
-- has not found the gate.

create table if not exists app.linked_gate_badges (
    -- The filename CHUNITHM-NET serves, without extension.
    filename    text primary key,

    -- One of the LinkedGateStatus values, or null while nobody has said.
    -- Null rather than a default: a guess here silently misreports progress,
    -- which is the bug this whole table exists to prevent.
    status      text
                check (status is null or status in (
                    'not_found', 'under_analysis', 'linkable', 'clear'
                )),

    -- Which gate it was seen on, from its position on the page. Not part of
    -- the key: the same artwork is reused across gates for some states.
    gate        text,

    -- Free text for whoever labels it — "seen on an account that had cleared
    -- SUN", and so on.
    note        text,

    first_seen  timestamptz not null default now(),
    labelled_at timestamptz
);

comment on table app.linked_gate_badges is
    'Meaning of each Linked GATE badge image. Rows appear automatically when '
    'an unrecognised badge is served; status is filled in by hand.';

create index if not exists linked_gate_badges_unlabelled_idx
    on app.linked_gate_badges (first_seen)
    where status is null;

-- The two badges this installation has established for itself, carried over.
--
-- Both were read off a live account on 2026-08-07 that had cleared SUN and
-- LUMINOUS, so the meaning is first-hand rather than inherited. Everything
-- else starts empty and fills in as players hit gates: an unlabelled badge
-- reads as "unknown", which is true, until someone who can see the hexagon
-- says otherwise.
insert into app.linked_gate_badges (filename, status, gate, note, labelled_at)
values
    ('0W4PTHG72IIN3OIG0GBR3SF8OPB87CPN', 'clear', 'sun',
     'Observed 2026-08-07 on an account that had cleared this gate.', now()),
    ('7Q0L2EVXCT9VNA4XNS3D8ELZ61QO21AV', 'clear', 'luminous',
     'Observed 2026-08-07 on an account that had cleared this gate.', now())
on conflict (filename) do nothing;
