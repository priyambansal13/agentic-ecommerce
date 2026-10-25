import { Controller, Get } from '@nestjs/common';
import { Principal, type PrincipalInfo } from './auth/auth.js';

/** GET /v1/whoami — the verified caller (requires a valid token). Handy for debugging realms, roles, scopes, act. */
@Controller('whoami')
export class WhoAmIController {
  @Get()
  whoami(@Principal() p: PrincipalInfo) {
    const { token: _token, ...rest } = p;
    return { service: process.env.SERVICE_NAME, ...rest };
  }
}
