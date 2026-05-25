-- BL1-1: assignments registry v2 (CRUD + event log + optimistic locking)

ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS media_ingest_job_id uuid;

ALTER TYPE assignment_source
ADD VALUE IF NOT EXISTS 'web_upload';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'assignment_event_type'
  ) THEN
    CREATE TYPE assignment_event_type AS ENUM (
      'created',
      'status_change',
      'field_change',
      'cancelled'
    );
  END IF;
END $$;

ALTER TABLE assignment_status_events
ADD COLUMN IF NOT EXISTS event_type assignment_event_type;

ALTER TABLE assignment_status_events
ALTER COLUMN to_status DROP NOT NULL;

ALTER TABLE assignment_status_events
ADD COLUMN IF NOT EXISTS field_name text;

ALTER TABLE assignment_status_events
ADD COLUMN IF NOT EXISTS old_value jsonb;

ALTER TABLE assignment_status_events
ADD COLUMN IF NOT EXISTS new_value jsonb;

UPDATE assignment_status_events
SET event_type = 'status_change'
WHERE event_type IS NULL;

ALTER TABLE assignment_status_events
ALTER COLUMN event_type SET NOT NULL;
