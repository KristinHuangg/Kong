import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import { ListServicesDto } from './dto/list-services.dto';
import { ServiceVersion } from './entities/service-version.entity';
import { Service } from './entities/service.entity';
import { ServicesService } from './services.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SERVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Unit tests: the repositories are mocked, so these assert this service's own
 * logic (pagination arithmetic, tenant scoping, error translation, response
 * shape) without needing a database.
 *
 * That the generated SQL is actually correct is not something a mock can prove,
 * so it is covered by the integration suite in test/services.e2e-spec.ts.
 */

/** Chainable stand-in for TypeORM's SelectQueryBuilder. */
function createQueryBuilderMock(rows: unknown[], count: number) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
    getCount: jest.fn().mockResolvedValue(count),
  };
  return qb;
}

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SERVICE_ID,
    name: 'Locate Us',
    description: 'Find us',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    versionCount: 3,
    ...overrides,
  };
}

function buildServiceEntity(overrides: Partial<Service> = {}): Service {
  return {
    id: SERVICE_ID,
    organizationId: ORG_A,
    name: 'Locate Us',
    description: 'Find us',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    versions: [],
    organization: undefined as never,
    ...overrides,
  } as Service;
}

/** Mirrors the defaults ValidationPipe would apply to an empty query string. */
function listQuery(overrides: Partial<ListServicesDto> = {}): ListServicesDto {
  return Object.assign(new ListServicesDto(), overrides);
}

describe('ServicesService', () => {
  let service: ServicesService;
  let serviceRepository: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };
  let versionRepository: {
    countBy: jest.Mock;
    find: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let entityManager: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    serviceRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };

    versionRepository = {
      countBy: jest.fn(),
      find: jest.fn(),
    };

    entityManager = {
      create: jest.fn((_entity, plain) => plain),
      save: jest.fn(),
    };

    dataSource = {
      // Runs the callback with a mock manager, so create() is exercised
      // without a real transaction.
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(entityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: getRepositoryToken(Service), useValue: serviceRepository },
        {
          provide: getRepositoryToken(ServiceVersion),
          useValue: versionRepository,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(ServicesService);
  });

  describe('findAll', () => {
    it('returns mapped rows with pagination metadata', async () => {
      const qb = createQueryBuilderMock([buildRow()], 14);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll(ORG_A, listQuery());

      expect(result.data).toEqual([
        {
          id: SERVICE_ID,
          name: 'Locate Us',
          description: 'Find us',
          versionCount: 3,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 12,
        total: 14,
        totalPages: 2,
      });
    });

    it('defaults to a page size of 12, matching the mockup grid', async () => {
      const qb = createQueryBuilderMock([], 0);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(ORG_A, listQuery());

      expect(qb.limit).toHaveBeenCalledWith(12);
      expect(qb.offset).toHaveBeenCalledWith(0);
    });

    it('converts page and limit into the right SQL offset', async () => {
      const qb = createQueryBuilderMock([], 100);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(ORG_A, listQuery({ page: 4, limit: 10 }));

      // Page 4 at 10 per page starts at row 30, not 40.
      expect(qb.offset).toHaveBeenCalledWith(30);
      expect(qb.limit).toHaveBeenCalledWith(10);
    });

    it('scopes every query to the caller organization', async () => {
      const qb = createQueryBuilderMock([], 0);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(ORG_B, listQuery());

      expect(qb.where).toHaveBeenCalledWith(
        's.organizationId = :organizationId',
        { organizationId: ORG_B },
      );
    });

    it('reports one page rather than zero when there are no results', async () => {
      const qb = createQueryBuilderMock([], 0);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll(ORG_A, listQuery());

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(1);
    });

    it('rounds partial pages up', async () => {
      const qb = createQueryBuilderMock([], 25);
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll(ORG_A, listQuery({ limit: 10 }));

      expect(result.meta.totalPages).toBe(3);
    });

    it('preserves a versionCount of zero for a service with no versions', async () => {
      const qb = createQueryBuilderMock(
        [buildRow({ name: 'Legacy SOAP Bridge', versionCount: 0 })],
        1,
      );
      serviceRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll(ORG_A, listQuery());

      expect(result.data[0].versionCount).toBe(0);
    });

    describe('search', () => {
      it('matches on lower(name) with LIKE, not ILIKE', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery({ search: 'Loc' }));

        const [condition, parameters] = qb.andWhere.mock.calls[0];

        // The supporting index is on lower(name) varchar_pattern_ops, and
        // Postgres only uses it when the predicate matches that expression.
        // ILIKE cannot use it, so this assertion guards a performance
        // characteristic that is otherwise easy to regress.
        expect(condition).toContain('lower(s.name) LIKE');
        expect(condition).not.toContain('ILIKE');
        expect(parameters).toEqual({ search: 'Loc' });
      });

      it('escapes LIKE wildcards so they are treated literally', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery({ search: '100%_a\\b' }));

        const [, parameters] = qb.andWhere.mock.calls[0];

        expect(parameters).toEqual({ search: '100\\%\\_a\\\\b' });
      });

      it('applies the filter to the count query as well as the row query', async () => {
        // Without this, meta.total would report every service in the org while
        // data showed only the matches.
        const rowsQb = createQueryBuilderMock([], 0);
        const countQb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder
          .mockReturnValueOnce(rowsQb)
          .mockReturnValueOnce(countQb);

        await service.findAll(ORG_A, listQuery({ search: 'Loc' }));

        expect(rowsQb.andWhere).toHaveBeenCalledTimes(1);
        expect(countQb.andWhere).toHaveBeenCalledTimes(1);
      });

      it('adds no filter when search is omitted', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery());

        expect(qb.andWhere).not.toHaveBeenCalled();
      });
    });

    describe('sorting', () => {
      it('sorts by createdAt descending by default', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery());

        expect(qb.orderBy).toHaveBeenCalledWith('s.createdAt', 'DESC');
      });

      it('honours an explicit sort field and direction', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery({ sort: 'name', order: 'asc' }));

        expect(qb.orderBy).toHaveBeenCalledWith('s.name', 'ASC');
      });

      it('always appends a unique tie-breaker for stable pagination', async () => {
        const qb = createQueryBuilderMock([], 0);
        serviceRepository.createQueryBuilder.mockReturnValue(qb);

        await service.findAll(ORG_A, listQuery({ sort: 'name' }));

        // Equal names would otherwise order arbitrarily, letting rows shift
        // between pages.
        expect(qb.addOrderBy).toHaveBeenCalledWith('s.id', 'ASC');
      });
    });
  });

  describe('findOne', () => {
    it('returns the summary shape with a version count', async () => {
      serviceRepository.findOne.mockResolvedValue(buildServiceEntity());
      versionRepository.countBy.mockResolvedValue(3);

      const result = await service.findOne(ORG_A, SERVICE_ID, false);

      expect(result).toEqual({
        id: SERVICE_ID,
        name: 'Locate Us',
        description: 'Find us',
        versionCount: 3,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('returns the versions array instead of a count when asked', async () => {
      serviceRepository.findOne.mockResolvedValue(buildServiceEntity());
      versionRepository.find.mockResolvedValue([
        {
          id: 'v1',
          serviceId: SERVICE_ID,
          version: 'v1.0.0',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.findOne(ORG_A, SERVICE_ID, true);

      expect(result).toEqual({
        id: SERVICE_ID,
        name: 'Locate Us',
        description: 'Find us',
        versions: [
          {
            id: 'v1',
            version: 'v1.0.0',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });
      expect(result).not.toHaveProperty('versionCount');
      expect(versionRepository.countBy).not.toHaveBeenCalled();
    });

    it('orders versions deterministically', async () => {
      serviceRepository.findOne.mockResolvedValue(buildServiceEntity());
      versionRepository.find.mockResolvedValue([]);

      await service.findOne(ORG_A, SERVICE_ID, true);

      expect(versionRepository.find).toHaveBeenCalledWith({
        where: { serviceId: SERVICE_ID },
        order: { createdAt: 'ASC', version: 'ASC' },
      });
    });

    it('includes the organization in the lookup so another tenant cannot read it', async () => {
      serviceRepository.findOne.mockResolvedValue(buildServiceEntity());
      versionRepository.countBy.mockResolvedValue(0);

      await service.findOne(ORG_A, SERVICE_ID, false);

      expect(serviceRepository.findOne).toHaveBeenCalledWith({
        where: { id: SERVICE_ID, organizationId: ORG_A },
      });
    });

    it('throws NotFound when the service does not exist', async () => {
      serviceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(ORG_A, SERVICE_ID, false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound rather than Forbidden for another tenant service', async () => {
      // The org is part of the WHERE clause, so a cross-tenant id simply finds
      // nothing. Answering 403 would confirm the record exists.
      serviceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(ORG_B, SERVICE_ID, false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a service with no versions', async () => {
      const saved = buildServiceEntity({ name: 'New Service' });
      entityManager.save.mockResolvedValue(saved);

      const result = await service.create(ORG_A, { name: 'New Service' });

      expect(result.versions).toEqual([]);
      expect(result.name).toBe('New Service');
      // One save for the service, none for versions.
      expect(entityManager.save).toHaveBeenCalledTimes(1);
    });

    it('creates a service together with its versions', async () => {
      const saved = buildServiceEntity({ name: 'New Service' });
      entityManager.save.mockResolvedValueOnce(saved).mockResolvedValueOnce([
        {
          id: 'v1',
          serviceId: SERVICE_ID,
          version: 'v1.0.0',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.create(ORG_A, {
        name: 'New Service',
        versions: ['v1.0.0'],
      });

      expect(result.versions).toEqual([
        {
          id: 'v1',
          version: 'v1.0.0',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    });

    it('assigns the caller organization, not one from the payload', async () => {
      entityManager.save.mockResolvedValue(buildServiceEntity());

      await service.create(ORG_B, { name: 'New Service' });

      expect(entityManager.create).toHaveBeenCalledWith(
        Service,
        expect.objectContaining({ organizationId: ORG_B }),
      );
    });

    it('stores a missing description as null rather than undefined', async () => {
      entityManager.save.mockResolvedValue(buildServiceEntity());

      await service.create(ORG_A, { name: 'New Service' });

      expect(entityManager.create).toHaveBeenCalledWith(
        Service,
        expect.objectContaining({ description: null }),
      );
    });

    it('runs inside a transaction', async () => {
      entityManager.save.mockResolvedValue(buildServiceEntity());

      await service.create(ORG_A, { name: 'New Service' });

      // Otherwise a failure while inserting versions would leave a service
      // with only some of the ones requested.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('translates a duplicate name violation into 409 Conflict', async () => {
      entityManager.save.mockRejectedValue(
        uniqueViolation('uq_services_org_name'),
      );

      await expect(
        service.create(ORG_A, { name: 'Locate Us' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not swallow a unique violation from a different constraint', async () => {
      const other = uniqueViolation('some_other_constraint');
      entityManager.save.mockRejectedValue(other);

      await expect(service.create(ORG_A, { name: 'X' })).rejects.toBe(other);
    });

    it('rethrows unrelated database errors untouched', async () => {
      const boom = new Error('connection reset');
      entityManager.save.mockRejectedValue(boom);

      await expect(service.create(ORG_A, { name: 'X' })).rejects.toBe(boom);
    });
  });
});

/** Builds the QueryFailedError shape the pg driver produces for code 23505. */
function uniqueViolation(constraint: string): QueryFailedError {
  const error = new QueryFailedError('INSERT INTO services', [], {
    code: '23505',
    constraint,
  } as unknown as Error);

  return error;
}
