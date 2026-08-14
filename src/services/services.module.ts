import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ServiceVersion } from './entities/service-version.entity';
import { Service } from './entities/service.entity';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

/**
 * A single module for the whole feature.
 *
 * The read and write paths share one controller and one service rather than
 * being split CQRS-style: the core scope is read-only, and separating them
 * would add deployment surface without buying anything at this size. The seam
 * for a later split is the service class, which is where a write path would be
 * extracted if write volume ever needed to scale independently.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Service, ServiceVersion]), AuthModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
