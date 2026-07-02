-- Plantbase — read-only szerepkör (NFR1, architektura.md 2. pont).
-- Ez a szkript az /docker-entrypoint-initdb.d/-ből fut, a POSTGRES_USER (plantbase,
-- az owner/RW user) jogosultságával, CSAK az első konténer-indításkor.
--
-- A plantbase_ro user kizárólag SELECT-et kaphat: se INSERT/UPDATE/DELETE, se DDL.
-- Ez a DB-szintű, elsődleges védelem; a kód-szintű assertSelectOnly a második réteg.

-- Read-only login szerepkör. (A jelszó egyezik a .env.example DATABASE_URL_READONLY-jával.)
CREATE ROLE plantbase_ro WITH LOGIN PASSWORD 'plantbase_ro';

-- Kapcsolódás és a public séma használata (olvasáshoz).
GRANT CONNECT ON DATABASE plantbase TO plantbase_ro;
GRANT USAGE ON SCHEMA public TO plantbase_ro;

-- A már létező táblákra SELECT (initkor még nincs tábla, de idempotens).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO plantbase_ro;

-- Kulcslépés: a KÉSŐBB (Prisma migrate, a plantbase userrel) létrejövő táblákra is
-- automatikus SELECT — enélkül a friss products tábla nem lenne olvasható az RO usernek.
ALTER DEFAULT PRIVILEGES FOR ROLE plantbase IN SCHEMA public
  GRANT SELECT ON TABLES TO plantbase_ro;
