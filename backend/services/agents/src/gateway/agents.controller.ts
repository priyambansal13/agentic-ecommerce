import { Controller, Get } from '@nestjs/common';
import { Public } from '@ac/nest-common';
import { AgentRuntime } from '../runtime/agent-runtime.service.js';

@Controller('agents')
export class AgentsController {
  constructor(private readonly runtime: AgentRuntime) {}

  /** GET /v1/agents — registered agents and their effective autonomy level */
  @Public()
  @Get()
  list() {
    return this.runtime.list();
  }
}
