-- Idempotent. Run as a PostgreSQL superuser (or a role with CREATEROLE) when provisioning or rotating passwords.
-- Passwords are supplied via psql variables so they never live in this file:
--   psql -v owner_pw="..." -v app_pw="..." -v system_pw="..." -v backup_pw="..." -v db=millerenos -f bootstrap-roles.sql
\set ON_ERROR_STOP on
\if :{?backup_pw}
\else
  \set backup_pw ''
\endif

SELECT format('CREATE ROLE millerenos_owner LOGIN PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_owner') \gexec
SELECT format('ALTER ROLE millerenos_owner LOGIN PASSWORD %L NOBYPASSRLS', :'owner_pw') \gexec
SELECT format('CREATE ROLE millerenos_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_app') \gexec
SELECT format('ALTER ROLE millerenos_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_pw') \gexec
SELECT format('CREATE ROLE millerenos_system LOGIN PASSWORD %L NOBYPASSRLS', :'system_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_system') \gexec
SELECT format('ALTER ROLE millerenos_system LOGIN PASSWORD %L NOBYPASSRLS', :'system_pw') \gexec

-- Read-only backup role: must bypass RLS so pg_dump sees every tenant's rows. Used only by ops/backup.
SELECT format('CREATE ROLE millerenos_backup LOGIN PASSWORD %L BYPASSRLS', coalesce(nullif(:'backup_pw', ''), md5(random()::text)))
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_backup') \gexec
SELECT format('ALTER ROLE millerenos_backup LOGIN PASSWORD %L BYPASSRLS', :'backup_pw') WHERE :'backup_pw' <> '' \gexec
GRANT pg_read_all_data TO millerenos_backup;

SELECT format('CREATE DATABASE %I OWNER millerenos_owner', :'db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

\connect :db
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO millerenos_owner;
GRANT USAGE ON SCHEMA public TO millerenos_app, millerenos_system, millerenos_backup;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO millerenos_owner, millerenos_app, millerenos_system, millerenos_backup', :'db') \gexec
