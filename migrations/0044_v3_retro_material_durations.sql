-- Only metadata, never uploads or R2 objects.
ALTER TABLE v3_retro_material_receipts ADD COLUMN video_durations_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(video_durations_json));
ALTER TABLE v3_retro_material_receipts ADD COLUMN raw_video_seconds INTEGER NOT NULL DEFAULT 0 CHECK(raw_video_seconds>=0);
