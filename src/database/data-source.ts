import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../config/database.options';

/**
 * Standalone DataSource for the TypeORM CLI.
 *
 * The CLI runs outside the Nest application context, so it has no access to
 * ConfigModule and must load .env itself.
 */
loadEnv({ path: '.env' });

export const dataSourceOptions = buildDataSourceOptions(process.env);

// TypeORM 0.3 requires the CLI's -d flag to point at a file with a default
// export that is a DataSource instance.
export default new DataSource(dataSourceOptions);
