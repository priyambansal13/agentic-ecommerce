import multipart from '@fastify/multipart';
import { bootstrapService } from '@ac/nest-common';
import { AppModule } from './app.module.js';
import { MAX_EVIDENCE_BYTES } from './modules/returns/evidence-image.js';

await bootstrapService(AppModule, {
  name: 'returns',
  port: 4107,
  // evidence photo uploads only (other bodies keep the 1 MB JSON limit)
  beforeListen: async (app) => {
    await app.register(multipart as never, { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 5 } });
  },
});
