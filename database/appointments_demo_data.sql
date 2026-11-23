-- ============================================================================
-- fred's auto electrical: demo data for the appointments page
-- run AFTER fred_database_full.sql, fake_data.sql and add_reminder_enabled.sql.
-- for development only, never on production.
--
-- dates are worked out from today in guyana time, so the page always has
-- appointments today, this week, later this month, next month and in the past.
-- safe to run more than once: rows that already exist are skipped.
-- "booked by" is the first admin account.
-- ============================================================================

-- four more customers (leon has two vehicles, devon walsh has none on file)
INSERT INTO customers (customer_id, full_name, phone_number, email, address) VALUES
  ('00000000-0000-0000-0000-0000000000c6', 'Leon Chambers', '592-604-1299', 'leon@example.com', 'Lot 3 Croal Street, Georgetown'),
  ('00000000-0000-0000-0000-0000000000c7', 'Sandra Bowen',  '592-622-4510', NULL,               'Eccles, East Bank Demerara'),
  ('00000000-0000-0000-0000-0000000000c8', 'Priya Nair',    '592-655-7083', 'priya@example.com', 'Lot 18 Public Road, Kitty'),
  ('00000000-0000-0000-0000-0000000000c9', 'Devon Walsh',   '592-619-2044', NULL,               'Mon Repos, East Coast Demerara')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO vehicles (vehicle_id, customer_id, plate_number, make, model, year, colour, engine_trim) VALUES
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000c6', 'PRR 8924', 'Toyota',  'Hilux',  2015, 'White',  '2.5L'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000c6', 'PTT 2190', 'Toyota',  'RAV4',   2019, 'Blue',   '2.0L'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000c7', 'PKK 6631', 'Hyundai', 'Tucson', 2022, 'Grey',   '2.0L'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000c8', 'PMM 4402', 'Nissan',  'Note',   2020, 'Red',    '1.2L')
ON CONFLICT (vehicle_id) DO NOTHING;

-- appointments: day_offset is days from today (negative is the past),
-- at is the time of day in guyana, lead is the reminder in minutes
WITH t AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Guyana') AS d
),
demo (id, customer, vehicle, phone, service, day_offset, at, lead, reminder_on, status) AS (
  VALUES
    -- today
    ('d1', 'c7', 'a8',  '592-622-4510', 'Annual electrical inspection',           0, '09:00',   60, true,  'completed'),
    ('d2', 'c6', 'a6',  '592-604-1299', 'Starter motor clicking, won''t crank',   0, '14:00',  120, true,  'scheduled'),
    ('d3', 'c1', 'a1',  '592-600-1111', 'Battery and charging system test',       0, '16:30',   60, false, 'scheduled'),

    -- coming up this week and later
    ('d4', 'c2', 'a2',  '592-600-2222', 'Battery drains overnight',               1, '10:00', 1440, true,  'scheduled'),
    ('d5', 'c9', NULL,  '592-619-2044', 'Dashboard lights flickering',            2, '13:30',   60, true,  'scheduled'),
    ('d6', 'c8', 'a9',  '592-655-7083', 'Power window motor not working',         3, '09:00',   60, true,  'rescheduled'),
    ('d7', 'c3', 'a3',  '592-600-3333', 'Headlight wiring check',                 5, '11:00',   30, true,  'scheduled'),
    ('d8', 'c6', 'a7',  '592-604-1299', 'AC compressor clutch not engaging',      8, '15:00',   60, true,  'scheduled'),
    ('d9', 'c7', 'a8',  '592-622-4510', 'Alternator not charging',               12, '10:30',  120, true,  'scheduled'),
    ('da', 'c8', 'a9',  '592-655-7083', 'Central locking fault',                 18, '09:30',   60, false, 'scheduled'),
    ('d0', 'c9', NULL,  '592-619-2044', 'Full electrical check before road trip',32, '10:00', 1440, true,  'scheduled'),

    -- the past, one of each closed status
    ('db', 'c8', 'a9',  '592-655-7083', 'Horn not working',                      -1, '11:00',   60, true,  'completed'),
    ('dc', 'c9', NULL,  '592-619-2044', 'Reverse camera install',                -2, '15:00',   60, true,  'cancelled'),
    ('dd', 'c6', 'a6',  '592-604-1299', 'Battery replacement',                   -4, '10:00',   60, true,  'completed'),
    ('de', 'c2', 'a2',  '592-600-2222', 'Fuel pump relay clicking',              -6, '14:00',   30, true,  'missed'),
    ('df', 'c7', 'a8',  '592-622-4510', 'Ignition coil misfire',                -10, '09:00',   60, false, 'completed')
)
INSERT INTO appointments (
  appointment_id, customer_id, vehicle_id, contact_number, service_requested,
  appointment_datetime, reminder_lead_minutes, reminder_enabled, status, created_by, created_at
)
SELECT
  ('00000000-0000-0000-0000-0000000000' || r.id)::uuid,
  ('00000000-0000-0000-0000-0000000000' || r.customer)::uuid,
  ('00000000-0000-0000-0000-0000000000' || r.vehicle)::uuid,
  r.phone,
  r.service,
  -- local date and time in guyana, stored as timestamptz
  (t.d + make_interval(days => r.day_offset) + r.at::interval) AT TIME ZONE 'America/Guyana',
  r.lead,
  r.reminder_on,
  r.status::appointment_status,
  (SELECT profile_id FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
  -- booked about a week before the visit (or a week ago, for ones coming up)
  least(now(), (t.d + make_interval(days => r.day_offset - 7) + interval '9 hours 42 minutes') AT TIME ZONE 'America/Guyana')
FROM demo r, t
ON CONFLICT (appointment_id) DO NOTHING;

-- to remove just this data later (appointments first):
--   delete from appointments where appointment_id::text like '00000000-0000-0000-0000-0000000000d%';
--   delete from vehicles  where vehicle_id  in ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a7',
--                                               '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a9');
--   delete from customers where customer_id in ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000c7',
--                                               '00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c9');
