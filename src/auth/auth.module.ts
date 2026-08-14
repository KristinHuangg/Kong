import { Module } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Provides request authentication.
 *
 * The guard is applied per-controller with @UseGuards(JwtAuthGuard) rather than
 * registered globally, so that adding an unauthenticated route later (a health
 * check, for instance) does not require carving an exception out of a global
 * guard.
 */
@Module({
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
