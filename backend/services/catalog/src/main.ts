import multipart from '@fastify/multipart';
import { bootstrapService } from '@ac/nest-common';
import { AppModule } from './app.module.js';
import { MAX_IMAGE_BYTES } from './modules/images/image-processing.js';

await bootstrapService(AppModule, {
  name: 'catalog',
  port: 4102,
  // image uploads only (other bodies keep the 1 MB JSON limit)
  beforeListen: async (app) => {
    await app.register(multipart as never, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 } });
  },
});
