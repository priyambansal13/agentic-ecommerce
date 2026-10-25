-- Runs once, on first start of an empty volume.
-- Extensions go into template1 so every per-service database (ac_<db>, created by `ac infra init`)
-- inherits them without its owner needing superuser rights.
\c template1
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\c postgres
CREATE DATABASE langfuse;
