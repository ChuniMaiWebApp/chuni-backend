-- Removes the Linked GATE badge lookup added in 0013.
--
-- It existed to turn an opaque badge filename into a machine-readable status,
-- so the interface could print "Cleared" beside each gate. The interface no
-- longer does: CHUNITHM-NET serves the hexagon already drawn in the state that
-- gate is in, and the profile page shows that artwork and nothing else.
--
-- Which makes the table not merely unused but a liability. Filling it in was
-- manual, so it lagged reality — and both times a status was displayed from
-- it, the status was wrong while the artwork beside it was right. First every
-- gate read as cleared, then gates that were cleared read as not cleared. A
-- second, slower source of truth next to a picture that is already correct has
-- only one direction to fail in.
--
-- Nothing depended on the rows: the only reader was the profile card, and it
-- reads the image now. Dropping rather than leaving it to rot, because an
-- empty table with a repository still writing to it is how the next person
-- ends up wondering which one to trust.

drop index if exists app.linked_gate_badges_unlabelled_idx;
drop table if exists app.linked_gate_badges;
