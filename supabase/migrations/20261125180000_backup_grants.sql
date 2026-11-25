-- The backup worker (service_role key, stored only as a Cloudflare Worker secret) reads every table once a week.
grant usage on schema public to service_role;
grant select on all tables in schema public to service_role;
