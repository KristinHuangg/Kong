import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

import { AuthenticatedUser } from './authenticated-user';
import type { RequestWithUser } from './jwt-auth.guard';

/**
 * Injects the authenticated identity into a controller method.
 *
 *   findAll(@CurrentUser('organizationId') orgId: string)
 *   findAll(@CurrentUser() user: AuthenticatedUser)
 *
 * Keeps controllers free of `request.user` casting, and keeps the tenant id
 * out of any client-supplied DTO where it could be spoofed.
 */
export const CurrentUser = createParamDecorator(
  <K extends keyof AuthenticatedUser>(
    field: K | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[K] => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      // Reaching here means the route is missing JwtAuthGuard. That is a wiring
      // bug on our side, not a client error, so it must not surface as a 401.
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route that is not protected by JwtAuthGuard',
      );
    }

    return field ? user[field] : user;
  },
);
