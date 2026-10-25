import { Controller, Get, Optional, VERSION_NEUTRAL } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './auth/auth.js';

@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Optional() private readonly db?: DataSource) {}

  @Get()
  async health() {
    const checks: Record<string, string> = {};
    if (this.db) {
      try {
        await this.db.query('SELECT 1');
        checks.db = 'up';
      } catch {
        checks.db = 'down';
      }
    }
    const status = Object.values(checks).every((c) => c === 'up') ? 'ok' : 'degraded';
    return { status, service: process.env.SERVICE_NAME, checks };
  }
}
