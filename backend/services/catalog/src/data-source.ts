import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/product.entity.js';
import { MARKETPLACE_ENTITIES } from './modules/marketplace/entities.js';

loadServiceEnv();
/** TypeORM CLI: pnpm exec typeorm migration:run -d dist/data-source.js */
export default serviceDataSource([...ENTITIES, ...MARKETPLACE_ENTITIES]);
