import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthenticatedUser } from './authenticated-user';
import { decodeDevToken } from './dev-token';

/** Request with the identity this guard attaches. */
export type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * Reads `Authorization: Bearer <token>` and attaches the identity to
 * `request.user`. Verification is mocked - see src/auth/dev-token.ts.
 *
 * The contract it upholds is real, and that is the part worth reviewing: no
 * usable token means 401, and a request that gets through always carries a
 * validated organizationId.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException(
        'Expected header format: Authorization: Bearer <token>',
      );
    }

    const user = decodeDevToken(token);

    if (!user) {
      throw new UnauthorizedException('Invalid or malformed token');
    }

    request.user = user;

    return true;
  }
}
