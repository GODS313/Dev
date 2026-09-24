-- Idempotent. Run as a PostgreSQL superuser (or a role with CREATEROLE) when provisioning or rotating passwords.
-- Passwords are supplied via psql variables so they never live in this file:
--   psql -v owner_pw="..." -v app_pw="..." -v system_pw="..." -v db=millerenos -f bootstrap-roles.sql
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE millerenos_owner LOGIN PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_owner') \gexec
SELECT format('ALTER ROLE millerenos_owner LOGIN PASSWORD %L NOBYPASSRLS', :'owner_pw') \gexec
SELECT format('CREATE ROLE millerenos_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_app') \gexec
SELECT format('ALTER ROLE millerenos_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_pw') \gexec
SELECT format('CREATE ROLE millerenos_system LOGIN PASSWORD %L NOBYPASSRLS', :'system_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'millerenos_system') \gexec
SELECT format('ALTER ROLE millerenos_system LOGIN PASSWORD %L NOBYPASSRLS', :'system_pw') \gexec

SELECT format('CREATE DATABASE %I OWNER millerenos_owner', :'db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

\connect :db
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO millerenos_owner;
GRANT USAGE ON SCHEMA public TO millerenos_app, millerenos_system;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO millerenos_owner, millerenos_app, millerenos_system', :'db') \gexec
