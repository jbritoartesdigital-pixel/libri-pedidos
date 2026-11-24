CREATE TABLE v3_store_journeys (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 stage TEXT NOT NULL, stage_mask INTEGER NOT NULL DEFAULT 0,
 had_order INTEGER NOT NULL DEFAULT 0 CHECK(had_order IN (0,1)),
 order_id INTEGER UNIQUE REFERENCES v2_orders(id) ON DELETE SET NULL
);
CREATE INDEX v3_store_journeys_started ON v3_store_journeys(started_at);
CREATE INDEX v3_store_journeys_last_seen ON v3_store_journeys(last_seen_at);
