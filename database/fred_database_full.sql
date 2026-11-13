-- (postgresql)

-- section 1: enumerated types
CREATE TYPE user_role          AS ENUM ('admin','staff');
CREATE TYPE job_status         AS ENUM ('not_started','in_progress','awaiting_parts','overdue','ready_for_pickup','delivered');
CREATE TYPE appointment_status AS ENUM ('scheduled','completed','rescheduled','cancelled','missed');
CREATE TYPE photo_type         AS ENUM ('before','after','receipt');
CREATE TYPE sync_status        AS ENUM ('pending','synced','failed');


-- ----------------------------------------------------------------------------
-- section 2: tables
-- ----------------------------------------------------------------------------
CREATE TABLE profiles (
  profile_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  varchar(100) NOT NULL,
  email      varchar(150) NOT NULL UNIQUE,
  role       user_role NOT NULL DEFAULT 'staff',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  customer_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    varchar(100) NOT NULL,
  phone_number varchar(20)  NOT NULL CHECK (phone_number ~ '^[0-9+ -]{7,20}$'),
  email        varchar(150),
  address      varchar(200),
  created_by   uuid REFERENCES profiles(profile_id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  vehicle_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  plate_number varchar(15) NOT NULL UNIQUE,
  make         varchar(50) NOT NULL,
  model        varchar(50) NOT NULL,
  year         smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  colour       varchar(30),   -- added: the customer registration form (table 4.1.2.11) captures this
  engine_trim  varchar(50),   -- added: the customer registration form (table 4.1.2.11) captures this
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  job_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              uuid NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  vehicle_id               uuid NOT NULL REFERENCES vehicles(vehicle_id)   ON DELETE RESTRICT,
  problem_description      text NOT NULL,
  status                   job_status NOT NULL DEFAULT 'not_started',
  registered_at            timestamptz NOT NULL DEFAULT now(),
  expected_completion_date date,
  delivered_at             timestamptz,
  customer_supplied_parts  boolean NOT NULL DEFAULT false,
  note_for_next_time       varchar(255),
  created_by               uuid REFERENCES profiles(profile_id) ON DELETE SET NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivered_has_date CHECK (status <> 'delivered' OR delivered_at IS NOT NULL)
);

CREATE TABLE appointments (
  appointment_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  vehicle_id            uuid REFERENCES vehicles(vehicle_id) ON DELETE SET NULL,
  job_id                uuid REFERENCES jobs(job_id) ON DELETE SET NULL,
  contact_number        varchar(20)  NOT NULL,
  service_requested     varchar(255) NOT NULL,
  appointment_datetime  timestamptz  NOT NULL,
  reminder_lead_minutes integer NOT NULL DEFAULT 60 CHECK (reminder_lead_minutes > 0),
  status                appointment_status NOT NULL DEFAULT 'scheduled',
  google_event_id       varchar(255),
  sync_status           sync_status NOT NULL DEFAULT 'pending',
  created_by            uuid REFERENCES profiles(profile_id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_photos (
  photo_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  photo_type   photo_type NOT NULL,
  storage_path varchar(300) NOT NULL UNIQUE,
  uploaded_by  uuid REFERENCES profiles(profile_id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_records (
  sale_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL UNIQUE REFERENCES jobs(job_id) ON DELETE RESTRICT,
  receipt_photo_id uuid NOT NULL REFERENCES job_photos(photo_id) ON DELETE RESTRICT,
  amount_paid      numeric(12,2) NOT NULL CHECK (amount_paid > 0),
  payment_date     date NOT NULL DEFAULT current_date
);

CREATE TABLE parts (
  part_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name         varchar(100) NOT NULL UNIQUE,
  alert_threshold   integer CHECK (alert_threshold > 0),
  alert_period_days integer NOT NULL DEFAULT 30 CHECK (alert_period_days > 0),
  is_active         boolean NOT NULL DEFAULT true
);

CREATE TABLE job_parts (
  job_id   uuid NOT NULL REFERENCES jobs(job_id)   ON DELETE CASCADE,
  part_id  uuid NOT NULL REFERENCES parts(part_id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (job_id, part_id)
);


-- ----------------------------------------------------------------------------
-- section 3: helper functions for roles
-- security definer so they can read profiles regardless of row level security
-- ----------------------------------------------------------------------------
CREATE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE profile_id = auth.uid() AND role = 'admin' AND is_active
  );
$$;

CREATE FUNCTION is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE profile_id = auth.uid() AND is_active
  );
$$;


-- ----------------------------------------------------------------------------
-- section 4: triggers
-- ----------------------------------------------------------------------------

-- a job's vehicle must belong to the job's customer
CREATE FUNCTION check_job_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles
                 WHERE vehicle_id = NEW.vehicle_id AND customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to this customer';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_job_vehicle
  BEFORE INSERT OR UPDATE OF customer_id, vehicle_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION check_job_vehicle();

-- an appointment's vehicle (if any) must belong to the appointment's customer
CREATE FUNCTION check_appointment_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM vehicles
       WHERE vehicle_id = NEW.vehicle_id AND customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to this customer';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_appointment_vehicle
  BEFORE INSERT OR UPDATE OF customer_id, vehicle_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_appointment_vehicle();

-- a job cannot be delivered until a sales record (receipt and amount) exists
-- security definer so the check still works when row level security hides sales rows
CREATE FUNCTION check_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND NOT EXISTS (SELECT 1 FROM sales_records WHERE job_id = NEW.job_id) THEN
    RAISE EXCEPTION 'A receipt and amount paid are required before delivery';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_job_delivery
  BEFORE UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION check_delivery();

-- keep jobs.updated_at current on every update
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- create a profile row whenever an account is created in supabase auth
-- the role always starts as staff; role is never read from user-editable metadata
CREATE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (profile_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ----------------------------------------------------------------------------
-- section 5: indexes for search and reports
-- ----------------------------------------------------------------------------
CREATE INDEX idx_customers_name      ON customers (lower(full_name));
CREATE INDEX idx_vehicles_cust       ON vehicles (customer_id);
CREATE INDEX idx_vehicles_make_model ON vehicles (lower(make), lower(model));
CREATE INDEX idx_jobs_vehicle        ON jobs (vehicle_id);
CREATE INDEX idx_jobs_customer       ON jobs (customer_id);
CREATE INDEX idx_jobs_status         ON jobs (status);
CREATE INDEX idx_jobs_registered     ON jobs (registered_at);
CREATE INDEX idx_jobs_problem_search ON jobs USING gin (to_tsvector('english', problem_description));
CREATE INDEX idx_appt_datetime       ON appointments (appointment_datetime);
CREATE INDEX idx_appt_customer       ON appointments (customer_id);
CREATE INDEX idx_photos_job          ON job_photos (job_id);
CREATE INDEX idx_jobparts_part       ON job_parts (part_id);


-- ----------------------------------------------------------------------------
-- section 6: row level security
-- rule: active staff and admins can read and write operational data,
-- only admins can delete, manage parts, manage accounts and run reports
-- ----------------------------------------------------------------------------
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_parts     ENABLE ROW LEVEL SECURITY;

-- profiles: everyone active can read (names appear on records), only admins change accounts
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (is_active_member());
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY profiles_delete ON profiles FOR DELETE TO authenticated
  USING (is_admin());

-- operational tables share the same four policies
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','vehicles','jobs','appointments','job_photos','job_parts']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_active_member())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (is_active_member())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (is_active_member()) WITH CHECK (is_active_member())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (is_admin())', t || '_delete', t);
  END LOOP;
END $$;

-- sales records: staff record the payment at delivery, only admins can correct or remove it
CREATE POLICY sales_records_select ON sales_records FOR SELECT TO authenticated
  USING (is_active_member());
CREATE POLICY sales_records_insert ON sales_records FOR INSERT TO authenticated
  WITH CHECK (is_active_member());
CREATE POLICY sales_records_update ON sales_records FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY sales_records_delete ON sales_records FOR DELETE TO authenticated
  USING (is_admin());

-- parts: everyone active can read the list, only admins manage it
CREATE POLICY parts_select ON parts FOR SELECT TO authenticated
  USING (is_active_member());
CREATE POLICY parts_insert ON parts FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY parts_update ON parts FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY parts_delete ON parts FOR DELETE TO authenticated
  USING (is_admin());


-- ----------------------------------------------------------------------------
-- section 7: overdue flagging
-- flags jobs whose expected completion date has passed
-- awaiting_parts jobs are left alone; remove the status filter if they should go overdue too
-- ----------------------------------------------------------------------------
CREATE FUNCTION mark_overdue_jobs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  UPDATE jobs
     SET status = 'overdue'
   WHERE status IN ('not_started','in_progress')
     AND expected_completion_date IS NOT NULL
     AND expected_completion_date < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- only the database scheduler (and admins through rpc) should run it
REVOKE ALL ON FUNCTION mark_overdue_jobs() FROM PUBLIC, anon;

-- schedule it nightly with pg_cron (enable the extension in supabase first):
--   create extension if not exists pg_cron;
--   select cron.schedule('mark-overdue-jobs', '5 4 * * *', $$select public.mark_overdue_jobs()$$);
-- 04:05 utc is 12:05 am in guyana


-- ----------------------------------------------------------------------------
-- section 8: reporting views and functions
-- views run with the caller's permissions and return rows to admins only
-- ----------------------------------------------------------------------------

-- dashboard: number of jobs in each status
CREATE VIEW v_job_status_counts WITH (security_invoker = true) AS
SELECT status, count(*)::int AS job_count
FROM jobs
WHERE is_admin()
GROUP BY status;

-- turnaround time for every delivered job
CREATE VIEW v_job_turnaround WITH (security_invoker = true) AS
SELECT j.job_id,
       j.registered_at,
       j.delivered_at,
       round((extract(epoch FROM (j.delivered_at - j.registered_at)) / 86400)::numeric, 1) AS turnaround_days
FROM jobs j
WHERE j.delivered_at IS NOT NULL
  AND is_admin();

-- monthly report: jobs, customers, missed appointments, revenue and turnaround
CREATE VIEW v_monthly_report WITH (security_invoker = true) AS
WITH months AS (
  SELECT date_trunc('month', registered_at)::date        AS m FROM jobs
  UNION SELECT date_trunc('month', created_at)::date           FROM customers
  UNION SELECT date_trunc('month', appointment_datetime)::date FROM appointments
  UNION SELECT date_trunc('month', payment_date)::date         FROM sales_records
)
SELECT m.m AS report_month,
       (SELECT count(*) FROM jobs j
         WHERE date_trunc('month', j.registered_at)::date = m.m)::int AS jobs_registered,
       (SELECT count(*) FROM jobs j
         WHERE j.delivered_at IS NOT NULL
           AND date_trunc('month', j.delivered_at)::date = m.m)::int AS jobs_completed,
       (SELECT count(*) FROM customers c
         WHERE date_trunc('month', c.created_at)::date = m.m)::int AS new_customers,
       (SELECT count(*) FROM appointments a
         WHERE a.status = 'missed'
           AND date_trunc('month', a.appointment_datetime)::date = m.m)::int AS missed_appointments,
       (SELECT coalesce(sum(s.amount_paid), 0) FROM sales_records s
         WHERE date_trunc('month', s.payment_date)::date = m.m) AS revenue,
       (SELECT round(avg(extract(epoch FROM (j.delivered_at - j.registered_at)) / 86400)::numeric, 1)
          FROM jobs j
         WHERE j.delivered_at IS NOT NULL
           AND date_trunc('month', j.delivered_at)::date = m.m) AS avg_turnaround_days
FROM months m
WHERE is_admin()
ORDER BY m.m DESC;

-- restock alerts: parts used at or above their threshold inside their alert period
-- usage is counted from job_parts (no stock levels are tracked)
CREATE VIEW v_restock_alerts WITH (security_invoker = true) AS
SELECT p.part_id,
       p.part_name,
       p.alert_threshold,
       p.alert_period_days,
       u.used_in_period
FROM parts p
CROSS JOIN LATERAL (
  SELECT coalesce(sum(jp.quantity), 0)::int AS used_in_period
  FROM job_parts jp
  JOIN jobs j ON j.job_id = jp.job_id
  WHERE jp.part_id = p.part_id
    AND j.registered_at >= now() - make_interval(days => p.alert_period_days)
) u
WHERE p.is_active
  AND p.alert_threshold IS NOT NULL
  AND u.used_in_period >= p.alert_threshold
  AND is_admin();

-- similar past jobs: same make and model, ranked by how closely the problem text matches
-- any shared word counts as a match (words are joined with "or")
CREATE FUNCTION find_similar_jobs(p_job_id uuid)
RETURNS TABLE (
  similar_job_id      uuid,
  plate_number        varchar,
  make                varchar,
  model               varchar,
  vehicle_year        smallint,
  problem_description text,
  status              job_status,
  registered_at       timestamptz,
  relevance           real
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH src AS (
    SELECT j1.job_id,
           lower(v1.make)  AS make,
           lower(v1.model) AS model,
           replace(plainto_tsquery('english', j1.problem_description)::text, '&', '|')::tsquery AS q
    FROM jobs j1
    JOIN vehicles v1 ON v1.vehicle_id = j1.vehicle_id
    WHERE j1.job_id = p_job_id
  )
  SELECT j2.job_id, v2.plate_number, v2.make, v2.model, v2.year,
         j2.problem_description, j2.status, j2.registered_at,
         ts_rank(to_tsvector('english', j2.problem_description), src.q) AS relevance
  FROM src
  JOIN vehicles v2 ON lower(v2.make) = src.make AND lower(v2.model) = src.model
  JOIN jobs j2     ON j2.vehicle_id = v2.vehicle_id
  WHERE j2.job_id <> src.job_id
    AND to_tsvector('english', j2.problem_description) @@ src.q
  ORDER BY relevance DESC, j2.registered_at DESC
  LIMIT 10;
$$;


-- ----------------------------------------------------------------------------
-- section 9: storage bucket for job photos (private, jpg and png only)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('job-photos', 'job-photos', false, 5242880, ARRAY['image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;
-- 5242880 bytes is 5 mb; change it to match the size limit in the srs

CREATE POLICY job_photos_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos' AND public.is_active_member());
CREATE POLICY job_photos_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos' AND public.is_active_member());
CREATE POLICY job_photos_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'job-photos' AND public.is_admin());
CREATE POLICY job_photos_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos' AND public.is_admin());
