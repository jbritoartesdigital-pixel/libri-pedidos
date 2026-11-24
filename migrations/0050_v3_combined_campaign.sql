CREATE TABLE v3_combined_campaigns (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 two_percent INTEGER NOT NULL CHECK(two_percent BETWEEN 0 AND 50),
 three_percent INTEGER NOT NULL CHECK(three_percent BETWEEN two_percent AND 50),
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL CHECK(ends_at>starts_at),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER v3_combined_campaign_no_overlap BEFORE INSERT ON v3_combined_campaigns
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM v3_combined_campaigns c WHERE c.active=1 AND c.starts_at<NEW.ends_at AND c.ends_at>NEW.starts_at)
BEGIN SELECT RAISE(ABORT,'v3_campaign_overlap'); END;
