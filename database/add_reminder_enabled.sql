-- ============================================================================
-- fred's auto electrical: on/off switch for appointment reminders
-- run once in the supabase sql editor on a database made from an older
-- fred_database_full.sql (the full script already has this column)
-- turning a reminder off keeps reminder_lead_minutes, so turning it back on
-- remembers the old lead time
-- ============================================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT true;
