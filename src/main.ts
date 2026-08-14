import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/** Route prefix for every endpoint, e.g. GET /api/v1/services */
const GLOBAL_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(GLOBAL_PREFIX);

  /**
   * Global request validation.
   *
   * whitelist            - strips properties not declared on the DTO
   * forbidNonWhitelisted - rejects requests that send unknown properties
   * transform            - instantiates the DTO class so defaults and
   *                        @Transform/@Type conversions apply
   *
   * enableImplicitConversion is deliberately NOT enabled. It coerces by the
   * declared TypeScript type, which would turn a JSON body of { name: 42 }
   * into "42" and let it pass @IsString. Query parameters that genuinely need
   * coercion declare it explicitly with @Type(() => Number) instead, so the
   * conversion is visible at the field rather than implied globally.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Lets TypeORM close its connection pool cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  logger.log(`Listening on http://localhost:${port}/${GLOBAL_PREFIX}`);
}

void bootstrap();
