import { bootstrapService } from '@ac/nest-common';
import { AppModule } from './app.module.js';

await bootstrapService(AppModule, { name: 'order', port: 4105 });
