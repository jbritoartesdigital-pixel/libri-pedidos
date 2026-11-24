CREATE TABLE v3_store_journey_names (
 journey_id TEXT PRIMARY KEY REFERENCES v3_store_journeys(id) ON DELETE CASCADE,
 preferred_name TEXT NOT NULL CHECK(length(preferred_name) BETWEEN 1 AND 60),
 consent_version TEXT NOT NULL CHECK(consent_version='named-v1'),
 consented_at TEXT NOT NULL
);
