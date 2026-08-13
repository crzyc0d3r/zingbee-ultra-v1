-- Migrate scheduled_maintenance to daily-recurring time-of-day columns.
-- timetz stores time with a fixed UTC offset; the resolver in api/maintenance.py
-- combines this with today's date to compute each day's next window.

BEGIN;

ALTER TABLE public.scheduled_maintenance
    ALTER COLUMN start_date TYPE time with time zone USING start_date::time with time zone,
    ALTER COLUMN end_date   TYPE time with time zone USING end_date::time with time zone;

COMMIT;
