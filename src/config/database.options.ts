import { join } from 'path';

import type { DataSourceOptions } from 'typeorm';

/**
 * Single source of truth for database connection options.
 *
 * Used by two callers that would otherwise drift apart:
 *  1. TypeOrmModule.forRootAsync in DatabaseModule (the running app)
 *  2. src/database/data-source.ts (the TypeORM CLI, for migrations)
 */
export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USERNAME ?? 'postgres',
    password: env.DB_PASSWORD ?? 'postgres',
    database: env.DB_NAME ?? 'service_catalog',

    /**
     * Globs resolve relative to this file, so they work both under ts-node
     * (src/config -> src/**) and after compilation (dist/config -> dist/**).
     */
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.{ts,js}')],

    /**
     * Never true, in any environment.
     *
     * synchronize auto-alters tables to match entities, which silently drops
     * columns and cannot express the index types this schema needs (notably
     * varchar_pattern_ops). Schema changes go through explicit migrations so
     * they are reviewable and reversible.
     */
    synchronize: false,

    logging: env.DB_LOGGING === 'true' ? ['query', 'error'] : ['error'],
  };
}
