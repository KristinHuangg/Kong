import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { AuthenticatedUser } from './authenticated-user';
import { decodeDevToken, encodeDevToken } from './dev-token';
import { JwtAuthGuard } from './jwt-auth.guard';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const VALID_USER: AuthenticatedUser = {
  userId: USER_ID,
  organizationId: ORG_ID,
  email: 'dev@acme.example',
};

/**
 * The guard turns a token into the organizationId that scopes every query, so
 * its failure modes are a security boundary rather than a convenience. These
 * tests pin down that it fails closed.
 */
function contextWithHeader(authorization?: string): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; user?: AuthenticatedUser };
} {
  const request = {
    headers: authorization ? { authorization } : {},
  } as { headers: Record<string, string>; user?: AuthenticatedUser };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;

  return { context, request };
}

function tokenWithPayload(payload: unknown): string {
  return `mock.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.sig`;
}

describe('dev tokens', () => {
  it('round-trips a user', () => {
    expect(decodeDevToken(encodeDevToken(VALID_USER))).toEqual(VALID_USER);
  });

  it('omits email when it was not supplied', () => {
    const token = encodeDevToken({ userId: USER_ID, organizationId: ORG_ID });

    expect(decodeDevToken(token)).toEqual({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
  });

  it.each([
    ['not a token at all', 'garbage'],
    ['a payload that is not valid JSON', 'mock.!!!not-json!!!.sig'],
  ])('returns null for %s', (_label, token) => {
    expect(decodeDevToken(token)).toBeNull();
  });

  it.each([
    ['a payload that is not an object', '"a string"'],
    ['a non-UUID organizationId', { userId: USER_ID, organizationId: 'acme' }],
    ['a missing organizationId', { userId: USER_ID }],
    ['an empty userId', { userId: '', organizationId: ORG_ID }],
  ])('returns null for %s', (_label, payload) => {
    // Fail closed: a malformed tenant id must never reach a query.
    expect(decodeDevToken(tokenWithPayload(payload))).toBeNull();
  });
});

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('allows a valid bearer token and attaches the user', () => {
    const { context, request } = contextWithHeader(
      `Bearer ${encodeDevToken(VALID_USER)}`,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(VALID_USER);
  });

  it('accepts the scheme case-insensitively', () => {
    const { context } = contextWithHeader(
      `bearer ${encodeDevToken(VALID_USER)}`,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a bearer scheme with no token', 'Bearer'],
    ['a malformed token', 'Bearer nonsense'],
  ])('rejects %s', (_label, header) => {
    const { context } = contextWithHeader(header);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('leaves request.user unset when authentication fails', () => {
    const { context, request } = contextWithHeader('Bearer nonsense');

    expect(() => guard.canActivate(context)).toThrow();
    expect(request.user).toBeUndefined();
  });
});
