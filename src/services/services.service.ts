import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import {
  buildPaginationMeta,
  PaginatedResponse,
} from '../common/paginated-response';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import {
  ServiceSummaryResponse,
  ServiceWithVersionsResponse,
  toSummaryResponse,
  toWithVersionsResponse,
} from './dto/service-response.dto';
import { ServiceVersion } from './entities/service-version.entity';
import { Service } from './entities/service.entity';

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Row shape returned by the list query. It is a raw result rather than a
 * hydrated entity because versionCount is an aggregate with no entity field.
 */
interface RawServiceRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  versionCount: number;
}

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ServiceVersion)
    private readonly versionRepository: Repository<ServiceVersion>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Lists an organization's services: one page of cards for the grid.
   *
   * Version counts come from a single LEFT JOIN + GROUP BY rather than a query
   * per service, so page size does not drive query count (no N+1).
   */
  async findAll(
    organizationId: string,
    query: ListServicesDto,
  ): Promise<PaginatedResponse<ServiceSummaryResponse>> {
    const { page, limit, search, sort, order } = query;
    const offset = (page - 1) * limit;
    const direction = order === 'asc' ? 'ASC' : 'DESC';

    const rowsQuery = this.serviceRepository
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .addSelect('s.name', 'name')
      .addSelect('s.description', 'description')
      .addSelect('s.createdAt', 'createdAt')
      .addSelect('s.updatedAt', 'updatedAt')
      // ::int because COUNT returns bigint, which the pg driver surfaces as a
      // string to avoid precision loss. The API contract says number.
      .addSelect('COUNT(v.id)::int', 'versionCount')
      .leftJoin('s.versions', 'v')
      .where('s.organizationId = :organizationId', { organizationId })
      .groupBy('s.id')
      // `sort` is interpolated because ORDER BY cannot be parameterised. It is
      // safe only because ListServicesDto constrains it to an allowlist with
      // @IsIn, so anything else is rejected with a 400 before reaching here.
      .orderBy(`s.${sort}`, direction)
      // Tie-breaker on a unique column. Without it, rows with equal sort values
      // can be returned in a different order per request, which makes offset
      // pagination skip or repeat records across pages.
      .addOrderBy('s.id', 'ASC')
      .limit(limit)
      .offset(offset);

    const countQuery = this.serviceRepository
      .createQueryBuilder('s')
      .where('s.organizationId = :organizationId', { organizationId });

    if (search !== undefined) {
      this.applyNamePrefixSearch(rowsQuery, search);
      this.applyNamePrefixSearch(countQuery, search);
    }

    // Independent queries, so issue them concurrently.
    const [rows, total] = await Promise.all([
      rowsQuery.getRawMany<RawServiceRow>(),
      countQuery.getCount(),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        versionCount: row.versionCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /**
   * Fetches one service. Powers the detail page reached by clicking a card.
   *
   * With includeVersions, returns the full version list; otherwise just the
   * count, keeping the default response small.
   */
  async findOne(
    organizationId: string,
    serviceId: string,
    includeVersions: boolean,
  ): Promise<ServiceSummaryResponse | ServiceWithVersionsResponse> {
    // organizationId is part of the predicate rather than checked afterwards,
    // so a service belonging to another tenant is indistinguishable from one
    // that does not exist. Both yield 404 and neither confirms existence.
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId, organizationId },
    });

    if (!service) {
      throw new NotFoundException(`Service ${serviceId} not found`);
    }

    if (!includeVersions) {
      const versionCount = await this.versionRepository.countBy({ serviceId });
      return toSummaryResponse(service, versionCount);
    }

    // Fetched separately rather than as a relation so the ordering is explicit.
    // Relation loading gives no ordering guarantee, which would let the version
    // list shuffle between requests.
    const versions = await this.versionRepository.find({
      where: { serviceId },
      order: { createdAt: 'ASC', version: 'ASC' },
    });

    return toWithVersionsResponse(service, versions);
  }

  /**
   * Creates a service and its initial versions.
   *
   * Wrapped in a transaction so a failure partway through cannot leave a
   * service with only some of its requested versions.
   */
  async create(
    organizationId: string,
    dto: CreateServiceDto,
  ): Promise<ServiceWithVersionsResponse> {
    const versionStrings = dto.versions ?? [];

    return this.dataSource.transaction(async (manager) => {
      const service = manager.create(Service, {
        organizationId,
        name: dto.name,
        description: dto.description ?? null,
      });

      let saved: Service;
      try {
        saved = await manager.save(service);
      } catch (error) {
        // Relies on the uq_services_org_name constraint rather than a
        // pre-flight SELECT. A check-then-insert races: two concurrent requests
        // can both pass the check and both insert.
        if (this.isUniqueViolation(error, 'uq_services_org_name')) {
          throw new ConflictException(
            `A service named "${dto.name}" already exists in this organization`,
          );
        }
        throw error;
      }

      if (versionStrings.length === 0) {
        return toWithVersionsResponse(saved, []);
      }

      const versions = versionStrings.map((version) =>
        manager.create(ServiceVersion, { serviceId: saved.id, version }),
      );

      const savedVersions = await manager.save(versions);

      return toWithVersionsResponse(saved, savedVersions);
    });
  }

  /**
   * Case-insensitive prefix match.
   *
   * Written as `lower(name) LIKE lower(:term) || '%'` rather than the more
   * obvious ILIKE for a specific reason: the supporting index is
   * `(organization_id, lower(name) varchar_pattern_ops)`, and Postgres will
   * only use it when the query's expression matches the indexed expression
   * exactly. ILIKE cannot use a varchar_pattern_ops index at all, so it would
   * silently fall back to a sequential scan.
   *
   * The term is escaped so that %, _ and \ typed by a user are treated as
   * literal characters instead of wildcards.
   */
  private applyNamePrefixSearch(
    queryBuilder: {
      andWhere: (
        condition: string,
        parameters: Record<string, unknown>,
      ) => void;
    },
    search: string,
  ): void {
    queryBuilder.andWhere(
      `lower(s.name) LIKE lower(:search) || '%' ESCAPE '\\'`,
      { search: this.escapeLikePattern(search) },
    );
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private isUniqueViolation(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as
      | { code?: string; constraint?: string }
      | undefined;

    return (
      driverError?.code === PG_UNIQUE_VIOLATION &&
      driverError?.constraint === constraint
    );
  }
}
