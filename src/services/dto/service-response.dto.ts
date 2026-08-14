import { Service } from '../entities/service.entity';
import { ServiceVersion } from '../entities/service-version.entity';

/**
 * Response shapes are declared explicitly rather than returning entities
 * directly. Entities carry things the API should not promise or leak, such as
 * organizationId and loaded relations, and serialising them straight to JSON
 * makes the public contract an accident of the ORM mapping.
 */

export interface ServiceVersionResponse {
  id: string;
  version: string;
  createdAt: Date;
}

/** Card in the grid, and the default detail response. */
export interface ServiceSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Detail response when `?include=versions` is supplied. */
export interface ServiceWithVersionsResponse
  extends Omit<ServiceSummaryResponse, 'versionCount'> {
  versions: ServiceVersionResponse[];
}

export function toVersionResponse(
  version: ServiceVersion,
): ServiceVersionResponse {
  return {
    id: version.id,
    version: version.version,
    createdAt: version.createdAt,
  };
}

export function toSummaryResponse(
  service: Service,
  versionCount: number,
): ServiceSummaryResponse {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    versionCount,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export function toWithVersionsResponse(
  service: Service,
  versions: ServiceVersion[],
): ServiceWithVersionsResponse {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    versions: versions.map(toVersionResponse),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}
