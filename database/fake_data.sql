-- ============================================================================
-- fred's auto electrical: development seed data
-- run AFTER fred_database_full.sql. for development only, never on production.
-- all rows use fixed ids so the script is easy to re-read and clean up.
-- ============================================================================

-- parts with usage alert settings
INSERT INTO parts (part_name, alert_threshold, alert_period_days) VALUES
  ('Alternator',      3, 30),
  ('Starter motor',   3, 30),
  ('Battery',         5, 30),
  ('Ignition coil',   4, 30),
  ('Headlight bulb', 10, 30);

-- customers
INSERT INTO customers (customer_id, full_name, phone_number, email, address) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Ravi Persaud',   '592-600-1111', 'ravi@example.com',  'Lot 12 Sheriff Street, Georgetown'),
  ('00000000-0000-0000-0000-0000000000c2', 'Anita Williams', '592-600-2222', NULL,                'Lot 5 Vlissengen Road, Georgetown'),
  ('00000000-0000-0000-0000-0000000000c3', 'Devon Singh',    '592-600-3333', 'devon@example.com', 'Providence, East Bank Demerara');

-- vehicles
INSERT INTO vehicles (vehicle_id, customer_id, plate_number, make, model, year, colour, engine_trim) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'PXX 1234', 'Toyota', 'Allion',  2010, 'Silver', '1.8L'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', 'PYY 5678', 'Toyota', 'Allion',  2008, 'White',  '1.5L'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c3', 'HZZ 9012', 'Nissan', 'Tiida',   2012, 'Black',  '1.6L');

-- jobs in a mix of statuses (job 4 is overdue, job 5 gets delivered below)
INSERT INTO jobs (job_id, customer_id, vehicle_id, problem_description, status, registered_at, expected_completion_date) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   'Car will not start, battery light on, alternator whining', 'in_progress', now() - interval '2 days', current_date + 3),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2',
   'Battery drains overnight, starter clicks', 'awaiting_parts', now() - interval '5 days', current_date + 2),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3',
   'Headlight flickers and dashboard warning lights', 'not_started', now() - interval '1 day', current_date + 5),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   'Power windows not working', 'in_progress', now() - interval '10 days', current_date - 3),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2',
   'Alternator replacement, battery light on', 'ready_for_pickup', now() - interval '8 days', current_date - 1);

-- run the overdue check once so job 4 is flagged
SELECT mark_overdue_jobs();

-- parts used on jobs
INSERT INTO job_parts (job_id, part_id, quantity)
SELECT '00000000-0000-0000-0000-0000000000b1', part_id, 1 FROM parts WHERE part_name = 'Alternator';
INSERT INTO job_parts (job_id, part_id, quantity)
SELECT '00000000-0000-0000-0000-0000000000b2', part_id, 1 FROM parts WHERE part_name = 'Battery';
INSERT INTO job_parts (job_id, part_id, quantity)
SELECT '00000000-0000-0000-0000-0000000000b5', part_id, 1 FROM parts WHERE part_name = 'Alternator';

-- receipt for job 5 (the storage_path is a placeholder; no real file exists)
INSERT INTO job_photos (photo_id, job_id, photo_type, storage_path) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b5', 'receipt', 'dev/job-b5/receipt.jpg');

INSERT INTO sales_records (job_id, receipt_photo_id, amount_paid, payment_date) VALUES
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000d1', 45000.00, current_date);

-- deliver job 5 (allowed now because the sales record exists)
UPDATE jobs
   SET status = 'delivered', delivered_at = now()
 WHERE job_id = '00000000-0000-0000-0000-0000000000b5';

-- appointments, including one missed
INSERT INTO appointments (customer_id, vehicle_id, contact_number, service_requested, appointment_datetime, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '592-600-1111', 'Check power windows',  now() + interval '1 day',  'scheduled'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3', '592-600-3333', 'Headlight inspection', now() + interval '3 days', 'scheduled'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', '592-600-2222', 'Battery test',         now() - interval '2 days', 'missed');

-- ============================================================================
-- fred's auto electrical: extra missed appointments for the reports page
-- run AFTER fred_database_full.sql and fake_data.sql. for development only.
-- dates are worked out from now(), so there's always data this week, last week,
-- earlier this month, last month and earlier in the year
-- times are stored in utc: 14:00 utc is 10:00 am in guyana
-- ============================================================================

-- two more customers so the table isn't the same three names
INSERT INTO customers (customer_id, full_name, phone_number, email, address) VALUES
  ('00000000-0000-0000-0000-0000000000c4', 'Kevin Jagdeo',    '592-612-4890', NULL,                 'Lot 40 Middle Street, Georgetown'),
  ('00000000-0000-0000-0000-0000000000c5', 'Amara Phillips',  '592-684-2103', 'amara@example.com',  'Diamond, East Bank Demerara');

INSERT INTO vehicles (vehicle_id, customer_id, plate_number, make, model, year, colour, engine_trim) VALUES
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c4', 'PAA 4321', 'Toyota', 'Prado',  2015, 'Grey',  '2.7L'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c5', 'PBB 8765', 'Isuzu',  'D-Max',  2018, 'Red',   '3.0L');

-- missed appointments, newest first
INSERT INTO appointments (appointment_id, customer_id, vehicle_id, contact_number, service_requested, appointment_datetime, status) VALUES
  -- this week (shows up in the default week view)
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a4',
   '592-612-4890', 'Alternator not charging',            date_trunc('day', now()) - interval '1 day'  + interval '14 hours',             'missed'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a5',
   '592-684-2103', 'Alternator pulley whine and belt',   date_trunc('day', now()) - interval '1 day'  + interval '18 hours 30 minutes', 'missed'),

  -- last week (so the "vs last week" note has something to compare with)
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '592-600-1111', 'Central locking fault',              date_trunc('day', now()) - interval '8 days' + interval '15 hours',             'missed'),

  -- earlier this month / last month
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3',
   '592-600-3333', 'Dashboard warning lights',           date_trunc('day', now()) - interval '15 days' + interval '13 hours',            'missed'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a4',
   '592-612-4890', 'Starter clicking, won''t crank',     date_trunc('day', now()) - interval '35 days' + interval '16 hours',            'missed'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2',
   '592-600-2222', 'AC blower not working',              date_trunc('day', now()) - interval '42 days' + interval '14 hours',            'missed'),

  -- earlier in the year (year view)
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a5',
   '592-684-2103', 'Wiring check after accident',        date_trunc('day', now()) - interval '120 days' + interval '17 hours',           'missed'),
  -- no vehicle on this one, to check the table handles that
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000c1', NULL,
   '592-600-1111', 'Battery drain overnight',            date_trunc('day', now()) - interval '200 days' + interval '14 hours',           'missed');

-- to remove just this data later:
--   delete from appointments where appointment_id::text like '00000000-0000-0000-0000-0000000000e%';
--   delete from vehicles  where vehicle_id  in ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a5');
--   delete from customers where customer_id in ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c5');


-- to remove all dev data later (children first):
--   delete from sales_records; delete from job_photos; delete from job_parts;
--   delete from appointments;  delete from jobs;       delete from vehicles;
--   delete from customers;     delete from parts;