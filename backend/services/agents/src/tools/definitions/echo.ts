import { z } from 'zod';
import { defineTool } from '../define-tool.js';

/** Smoke-test tool for the ping agent: exercises zod → OPA → audit → AG-UI tool events without a domain service. */
export const echo = defineTool({
  name: 'echo',
  description: 'Echo text back (diagnostics only).',
  tier: 'READ',
  agents: ['ping'],
  input: z.object({ text: z.string().max(500) }),
  output: z.object({ echoed: z.string(), at: z.string() }),
  handler: async (_ctx, args) => ({ echoed: args.text, at: new Date().toISOString() }),
});
