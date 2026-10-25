import type { MigrationInterface, QueryRunner } from 'typeorm';

/** agents service: autonomy (kill switch), runs, run requests (event-driven triggers), eval reports — own database ac_agents. */
export class AgentGovernance1761700000000 implements MigrationInterface {
  name = 'AgentGovernance1761700000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE IF NOT EXISTS agent_autonomy (
        agent_id text PRIMARY KEY,
        level int NOT NULL CHECK (level BETWEEN 0 AND 4),
        changed_by text NOT NULL,
        reason text NOT NULL,
        changed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS agent_autonomy_history (
        id bigserial PRIMARY KEY,
        agent_id text NOT NULL,
        from_level int,
        to_level int NOT NULL,
        changed_by text NOT NULL,
        reason text NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id text PRIMARY KEY,
        agent_id text NOT NULL,
        subject text NOT NULL,
        mode text NOT NULL CHECK (mode IN ('SHADOW','RECOMMEND','LIVE')),
        status text NOT NULL CHECK (status IN ('RUNNING','INTERRUPTED','COMPLETED','FAILED','BLOCKED')),
        autonomy int NOT NULL,
        steps int NOT NULL DEFAULT 0,
        tool_calls int NOT NULL DEFAULT 0,
        denied_calls int NOT NULL DEFAULT 0,
        tokens int NOT NULL DEFAULT 0,
        outcome text,
        error text,
        model text,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS agent_runs_agent_started ON agent_runs (agent_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS agent_runs_subject ON agent_runs (subject);
      CREATE TABLE IF NOT EXISTS agent_run_requests (
        id uuid PRIMARY KEY,
        agent_id text NOT NULL,
        subject text NOT NULL,
        trigger text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
        attempts int NOT NULL DEFAULT 0,
        run_id text,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (agent_id, subject, trigger)
      );
      CREATE INDEX IF NOT EXISTS agent_run_requests_pending ON agent_run_requests (status, created_at) WHERE status = 'PENDING';
      CREATE TABLE IF NOT EXISTS eval_reports (
        id bigserial PRIMARY KEY,
        agent_id text NOT NULL,
        run_at timestamptz NOT NULL DEFAULT now(),
        passed boolean NOT NULL,
        report jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS eval_reports_agent ON eval_reports (agent_id, run_at DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS eval_reports; DROP TABLE IF EXISTS agent_run_requests; DROP TABLE IF EXISTS agent_runs;
      DROP TABLE IF EXISTS agent_autonomy_history; DROP TABLE IF EXISTS agent_autonomy;`);
  }
}
