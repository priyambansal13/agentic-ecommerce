import { bootstrapService } from '@ac/nest-common';
import { AppModule } from './app.module.js';

// 20 MB: evidence photos and AG-UI state can ride in the run body
await bootstrapService(AppModule, { name: 'agents', port: 4300, bodyLimitBytes: 20 * 1024 * 1024 });
