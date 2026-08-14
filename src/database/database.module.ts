import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildDataSourceOptions } from '../config/database.options';

/**
 * Wires TypeORM into the Nest DI container.
 *
 * forRootAsync (rather than forRoot with a literal object) means connection
 * options are resolved from ConfigService at boot, so tests can swap the
 * configuration without editing this module.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions({
          DB_HOST: config.get<string>('DB_HOST'),
          DB_PORT: config.get<string>('DB_PORT'),
          DB_USERNAME: config.get<string>('DB_USERNAME'),
          DB_PASSWORD: config.get<string>('DB_PASSWORD'),
          DB_NAME: config.get<string>('DB_NAME'),
          DB_LOGGING: config.get<string>('DB_LOGGING'),
        }),
    }),
  ],
})
export class DatabaseModule {}
