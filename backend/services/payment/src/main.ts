import { BadRequestException } from '@nestjs/common';
import { bootstrapService } from '@ac/nest-common';
import { AppModule } from './app.module.js';

await bootstrapService(AppModule, {
  name: 'payment',
  port: 4106,
  // Webhook signatures are computed over the exact bytes received: keep the raw JSON body as req.rawBody.
  beforeListen: async (app) => {
    await app.init();
    const f = app.getHttpAdapter().getInstance();
    f.removeContentTypeParser('application/json');
    f.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_048_576 }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      if (body === '') return done(null, undefined);
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new BadRequestException('Body is not valid JSON'), undefined);
      }
    });
  },
});
