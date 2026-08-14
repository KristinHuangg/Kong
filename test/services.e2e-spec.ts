import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { encodeDevToken } from '../src/auth/dev-token';
import { Organization } from '../src/services/entities/organization.entity';
import { ServiceVersion } from '../src/services/entities/service-version.entity';
import { Service } from '../src/services/entities/service.entity';

/**
 * Integration test: real HTTP request -> Nest -> TypeORM -> Postgres -> response.
 *
 * Runs against the same database as development. Rather than truncating tables,
 * the suite creates two organizations of its own and removes only those, before
 * and after the run. Since every endpoint is organization-scoped, this keeps the
 * assertions independent of whatever else is in the database and leaves seeded
 * development data untouched.
 *
 *   docker compose up -d
 *   npm run migration:run
 *   npm run test:e2e
 *
 * The value over the unit tests is that nothing is mocked. These assertions
 * exercise the SQL itself, which is where the interesting bugs live: the LEFT
 * JOIN aggregate, the functional-index-compatible search predicate, the
 * organization filter, and the unique constraint.
 */

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const USER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const TOKEN_A = encodeDevToken({ userId: USER_A, organizationId: ORG_A });
const TOKEN_B = encodeDevToken({ userId: USER_B, organizationId: ORG_B });

const authA = { Authorization: `Bearer ${TOKEN_A}` };
const authB = { Authorization: `Bearer ${TOKEN_B}` };

/**
 * Org A gets 14 services to mirror the mockup's "0 — 11 of 14".
 * Timestamps are staggered so created_at ordering is deterministic.
 */
interface ServiceFixture {
  name: string;
  versions: number;
  /** null exercises the nullable column, as the mockup has cards with no text. */
  description: string | null;
}

const ORG_A_SERVICES: ServiceFixture[] = [
  { name: 'Locate Us', versions: 3, description: 'Locate Us description' },
  { name: 'Collect Monday', versions: 3, description: null },
  { name: 'Contact Us', versions: 3, description: 'Contact Us description' },
  { name: 'Contact Us EU', versions: 1, description: null },
  {
    name: 'FX Rates International',
    versions: 4,
    description: 'FX International',
  },
  { name: 'FX Rates Domestic', versions: 2, description: 'FX Domestic' },
  { name: 'Notifications', versions: 3, description: null },
  { name: 'Notifications Digest', versions: 2, description: 'Digest' },
  { name: 'Priority Services', versions: 3, description: null },
  { name: 'Reporting', versions: 5, description: 'Reporting description' },
  { name: 'Security', versions: 3, description: 'Security description' },
  { name: 'Security Audit', versions: 1, description: null },
  { name: 'Payments Gateway', versions: 3, description: 'Payments' },
  // No versions: must still be listed, with versionCount 0.
  { name: 'Legacy SOAP Bridge', versions: 0, description: null },
];

describe('Services API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let serviceIdsByName: Map<string, string>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirrors main.ts. Without it the app under test would validate
    // differently from the one that actually runs.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    dataSource = app.get<DataSource>(getDataSourceToken());
    await seedTestData();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(Organization).delete([ORG_A, ORG_B]);
    }
    await app?.close();
  });

  async function seedTestData(): Promise<void> {
    const orgRepo = dataSource.getRepository(Organization);
    const serviceRepo = dataSource.getRepository(Service);
    const versionRepo = dataSource.getRepository(ServiceVersion);

    // Idempotent: cascade clears services and versions from a previous run.
    await orgRepo.delete([ORG_A, ORG_B]);

    await orgRepo.insert([
      { id: ORG_A, name: 'Org A' },
      { id: ORG_B, name: 'Org B' },
    ]);

    serviceIdsByName = new Map();

    for (const [index, spec] of ORG_A_SERVICES.entries()) {
      const inserted = await serviceRepo.insert({
        organizationId: ORG_A,
        name: spec.name,
        description: spec.description,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
      });

      const serviceId = inserted.identifiers[0].id as string;
      serviceIdsByName.set(spec.name, serviceId);

      if (spec.versions > 0) {
        await versionRepo.insert(
          Array.from({ length: spec.versions }, (_, v) => ({
            serviceId,
            version: `v${v + 1}.0.0`,
          })),
        );
      }
    }

    // Org B reuses one of Org A's names on purpose: uniqueness is per
    // organization, so this must be allowed.
    const orgBService = await serviceRepo.insert({
      organizationId: ORG_B,
      name: 'Notifications',
      description: 'Org B notifications',
    });
    serviceIdsByName.set(
      'OrgB:Notifications',
      orgBService.identifiers[0].id as string,
    );
  }

  describe('GET /api/v1/services', () => {
    it('returns the first page of 12 with accurate metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services')
        .set(authA)
        .expect(200);

      expect(res.body.data).toHaveLength(12);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 12,
        total: 14,
        totalPages: 2,
      });
    });

    it('returns the remaining 2 on the second page', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?page=2')
        .set(authA)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.page).toBe(2);
    });

    it('returns no overlap between pages', async () => {
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/v1/services?limit=7&page=1')
          .set(authA),
        request(app.getHttpServer())
          .get('/api/v1/services?limit=7&page=2')
          .set(authA),
      ]);

      const firstIds = first.body.data.map((s: { id: string }) => s.id);
      const secondIds = second.body.data.map((s: { id: string }) => s.id);

      expect(firstIds).toHaveLength(7);
      expect(secondIds).toHaveLength(7);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual(
        [],
      );
    });

    it('exposes each card field the mockup renders', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?search=Reporting')
        .set(authA)
        .expect(200);

      expect(res.body.data[0]).toEqual({
        id: expect.any(String),
        name: 'Reporting',
        description: 'Reporting description',
        versionCount: 5,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('computes version counts in one query without dropping zero-version rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?limit=100')
        .set(authA)
        .expect(200);

      const counts = new Map<string, number>(
        res.body.data.map((s: { name: string; versionCount: number }) => [
          s.name,
          s.versionCount,
        ]),
      );

      for (const spec of ORG_A_SERVICES) {
        expect(counts.get(spec.name)).toBe(spec.versions);
      }

      // The distinguishing case: an INNER JOIN would omit this entirely.
      expect(counts.get('Legacy SOAP Bridge')).toBe(0);
    });

    it('returns versionCount as a number, not a bigint string', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services')
        .set(authA)
        .expect(200);

      expect(typeof res.body.data[0].versionCount).toBe('number');
    });

    describe('search', () => {
      it.each([['Loc'], ['loc'], ['LOC'], ['lOc']])(
        'matches case-insensitively for %s',
        async (term) => {
          const res = await request(app.getHttpServer())
            .get(`/api/v1/services?search=${term}`)
            .set(authA)
            .expect(200);

          expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
            'Locate Us',
          ]);
        },
      );

      it('matches a prefix across multiple services', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=Security')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(2);
      });

      it('anchors to the start of the name', async () => {
        // "Rates" appears mid-name in two services but never as a prefix.
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=Rates')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(0);
      });

      it('handles a multi-word prefix', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=FX%20Rates')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(2);
      });

      it('reflects the filter in meta.total, not just in data', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=Contact')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(2);
        expect(res.body.data).toHaveLength(2);
      });

      it('treats % as a literal character rather than a wildcard', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=%25')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(0);
      });

      it('treats _ as a literal character rather than a wildcard', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=_ocate')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(0);
      });

      it('returns an empty page rather than an error for no matches', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=NoSuchService')
          .set(authA)
          .expect(200);

        expect(res.body.data).toEqual([]);
        expect(res.body.meta).toEqual({
          page: 1,
          limit: 12,
          total: 0,
          totalPages: 1,
        });
      });

      it('ignores a blank search term', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?search=%20%20')
          .set(authA)
          .expect(200);

        expect(res.body.meta.total).toBe(14);
      });
    });

    describe('sorting', () => {
      it('sorts by name ascending', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?sort=name&order=asc&limit=100')
          .set(authA)
          .expect(200);

        const names = res.body.data.map((s: { name: string }) => s.name);
        expect(names).toEqual([...names].sort());
      });

      it('sorts by name descending', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?sort=name&order=desc&limit=100')
          .set(authA)
          .expect(200);

        const names = res.body.data.map((s: { name: string }) => s.name);
        expect(names).toEqual([...names].sort().reverse());
      });

      it('defaults to newest first', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services')
          .set(authA)
          .expect(200);

        // Legacy SOAP Bridge was inserted last, so it has the latest created_at.
        expect(res.body.data[0].name).toBe('Legacy SOAP Bridge');
      });

      it('sorts by createdAt ascending when asked', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?sort=createdAt&order=asc')
          .set(authA)
          .expect(200);

        expect(res.body.data[0].name).toBe('Locate Us');
      });
    });

    describe('organization isolation', () => {
      it('shows each organization only its own services', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?limit=100')
          .set(authB)
          .expect(200);

        expect(res.body.meta.total).toBe(1);
        expect(res.body.data[0].name).toBe('Notifications');
        expect(res.body.data[0].description).toBe('Org B notifications');
      });

      it('keeps identically named services in different organizations separate', async () => {
        const [a, b] = await Promise.all([
          request(app.getHttpServer())
            .get('/api/v1/services?search=Notifications')
            .set(authA),
          request(app.getHttpServer())
            .get('/api/v1/services?search=Notifications')
            .set(authB),
        ]);

        expect(a.body.meta.total).toBe(2);
        expect(b.body.meta.total).toBe(1);
        expect(a.body.data[0].id).not.toBe(b.body.data[0].id);
      });
    });

    describe('validation', () => {
      it.each([
        ['page below 1', 'page=0'],
        ['non-numeric page', 'page=abc'],
        ['limit above the maximum', 'limit=101'],
        ['limit below 1', 'limit=0'],
        ['unknown sort field', 'sort=organizationId'],
        ['unknown sort direction', 'order=sideways'],
        ['unknown query parameter', 'organizationId=' + ORG_B],
      ])('rejects %s with 400', async (_label, qs) => {
        await request(app.getHttpServer())
          .get(`/api/v1/services?${qs}`)
          .set(authA)
          .expect(400);
      });

      it('reports every invalid field at once', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/services?page=0&limit=500&sort=nope')
          .set(authA)
          .expect(400);

        expect(res.body.message).toHaveLength(3);
      });

      it('accepts the documented maximum page size', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/services?limit=100')
          .set(authA)
          .expect(200);
      });
    });

    describe('authentication', () => {
      it('rejects a request with no token', async () => {
        await request(app.getHttpServer()).get('/api/v1/services').expect(401);
      });

      it('rejects a non-bearer scheme', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/services')
          .set({ Authorization: 'Basic dXNlcjpwYXNz' })
          .expect(401);
      });

      it('rejects a malformed token', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/services')
          .set({ Authorization: 'Bearer not-a-real-token' })
          .expect(401);
      });

      it('rejects a token whose organizationId is not a UUID', async () => {
        const bad = encodeDevToken({
          userId: USER_A,
          organizationId: 'org-a',
        });

        await request(app.getHttpServer())
          .get('/api/v1/services')
          .set({ Authorization: `Bearer ${bad}` })
          .expect(401);
      });
    });
  });

  describe('GET /api/v1/services/:serviceId', () => {
    it('returns the summary shape by default', async () => {
      const id = serviceIdsByName.get('Reporting');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/services/${id}`)
        .set(authA)
        .expect(200);

      expect(res.body).toEqual({
        id,
        name: 'Reporting',
        description: 'Reporting description',
        versionCount: 5,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(res.body).not.toHaveProperty('versions');
    });

    it('returns the full versions list with ?include=versions', async () => {
      const id = serviceIdsByName.get('Reporting');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/services/${id}?include=versions`)
        .set(authA)
        .expect(200);

      expect(res.body.versions).toHaveLength(5);
      expect(res.body.versions[0]).toEqual({
        id: expect.any(String),
        version: expect.any(String),
        createdAt: expect.any(String),
      });
      expect(res.body).not.toHaveProperty('versionCount');
    });

    it('returns an empty versions array for a service with none', async () => {
      const id = serviceIdsByName.get('Legacy SOAP Bridge');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/services/${id}?include=versions`)
        .set(authA)
        .expect(200);

      expect(res.body.versions).toEqual([]);
    });

    it('never exposes organizationId', async () => {
      const id = serviceIdsByName.get('Reporting');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/services/${id}`)
        .set(authA)
        .expect(200);

      expect(res.body).not.toHaveProperty('organizationId');
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services/99999999-9999-4999-8999-999999999999')
        .set(authA)
        .expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services/not-a-uuid')
        .set(authA)
        .expect(400);
    });

    it('returns 404, not 403, for another organization service', async () => {
      const id = serviceIdsByName.get('Reporting');

      // 403 would confirm the record exists. 404 discloses nothing.
      await request(app.getHttpServer())
        .get(`/api/v1/services/${id}`)
        .set(authB)
        .expect(404);
    });

    it('rejects an unsupported include value', async () => {
      const id = serviceIdsByName.get('Reporting');

      await request(app.getHttpServer())
        .get(`/api/v1/services/${id}?include=organization`)
        .set(authA)
        .expect(400);
    });

    it('requires authentication', async () => {
      const id = serviceIdsByName.get('Reporting');

      await request(app.getHttpServer())
        .get(`/api/v1/services/${id}`)
        .expect(401);
    });
  });

  describe('POST /api/v1/services', () => {
    it('creates a service with versions and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send({
          name: 'Created By Test',
          description: 'A created service',
          versions: ['v1.0.0', 'v1.1.0'],
        })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Created By Test',
        description: 'A created service',
        versions: [
          {
            id: expect.any(String),
            version: 'v1.0.0',
            createdAt: expect.any(String),
          },
          {
            id: expect.any(String),
            version: 'v1.1.0',
            createdAt: expect.any(String),
          },
        ],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('persists the new service so it appears in the list', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send({ name: 'Persisted Service' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/services?search=Persisted')
        .set(authA)
        .expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].versionCount).toBe(0);
    });

    it('collapses duplicate versions in the request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send({ name: 'Deduped Versions', versions: ['v1.0.0', 'v1.0.0'] })
        .expect(201);

      expect(res.body.versions).toHaveLength(1);
    });

    it('returns 409 for a duplicate name in the same organization', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send({ name: 'Locate Us' })
        .expect(409);
    });

    it('allows the same name in a different organization', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authB)
        .send({ name: 'Locate Us' })
        .expect(201);
    });

    it('assigns the caller organization, ignoring the body', async () => {
      // organizationId is not on the DTO, so forbidNonWhitelisted rejects an
      // attempt to point a new service at another tenant.
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send({ name: 'Injection Attempt', organizationId: ORG_B })
        .expect(400);
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a whitespace-only name', { name: '   ' }],
      ['a non-string name', { name: 42 }],
      ['a name over 255 characters', { name: 'x'.repeat(256) }],
      ['an empty version string', { name: 'Bad Versions', versions: [''] }],
      ['a non-array versions field', { name: 'Bad Versions', versions: 'v1' }],
    ])('rejects %s with 400', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(authA)
        .send(body)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .send({ name: 'Unauthenticated' })
        .expect(401);
    });
  });
});
