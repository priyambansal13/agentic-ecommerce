import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/admin.entity.js';

loadServiceEnv();
/** TypeORM CLI: pnpm exec typeorm migration:run -d dist/data-source.js */
export default serviceDataSource(ENTITIES);
