import { isUUID } from 'class-validator';

import { AuthenticatedUser } from './authenticated-user';

/**
 * MOCK bearer tokens - not secure, not for production.
 *
 * A token is three dot-separated segments like a JWT, but only the middle one
 * carries data and the signature is a fixed placeholder that is never verified.
 * Anyone can mint a token for any organization.
 *
 * That is a deliberate, scoped shortcut. The exercise asks for authentication on
 * the API, and the part worth reviewing is how identity reaches the query
 * scoping, not how to operate a signing key. Real verification would replace the
 * decode call in JwtAuthGuard with passport-jwt checking the IdP's public key;
 * nothing downstream changes, because everything downstream depends only on the
 * AuthenticatedUser interface.
 */

const SIGNATURE = 'mock-signature-not-verified';

export function encodeDevToken(user: AuthenticatedUser): string {
  const payload = Buffer.from(JSON.stringify(user), 'utf8').toString(
    'base64url',
  );

  return `mock.${payload}.${SIGNATURE}`;
}

/**
 * Returns null for anything unusable, so the caller fails closed. The claims are
 * shape-checked because organizationId gates every query and must never reach
 * the database as an unusable value.
 */
export function decodeDevToken(token: string): AuthenticatedUser | null {
  const payload = token.split('.')[1];

  if (!payload) {
    return null;
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof claims !== 'object' || claims === null) {
    return null;
  }

  const { userId, organizationId, email } = claims as Record<string, unknown>;

  if (typeof organizationId !== 'string' || !isUUID(organizationId)) {
    return null;
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    return null;
  }

  return {
    userId,
    organizationId,
    ...(typeof email === 'string' ? { email } : {}),
  };
}
