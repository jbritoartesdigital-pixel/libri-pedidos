-- Released capacity is not removed from the commercial scope or historical points.
ALTER TABLE v3_order_services ADD COLUMN released_points_units INTEGER NOT NULL DEFAULT 0 CHECK(released_points_units>=0 AND released_points_units<=points_units);
CREATE TABLE v3_service_capacity_releases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE RESTRICT,
 day TEXT NOT NULL,
 points_units INTEGER NOT NULL CHECK(points_units>0),
 released_at TEXT NOT NULL,
 UNIQUE(service_id,day)
);
