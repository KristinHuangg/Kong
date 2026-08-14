/**
 * Pagination envelope shared by every list endpoint.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    // An empty result set is one page of nothing, not zero pages. Returning 0
    // would make a client's "page 1 of 0" render awkwardly.
    totalPages: total === 0 ? 1 : Math.ceil(total / limit),
  };
}
