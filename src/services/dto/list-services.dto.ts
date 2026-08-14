import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Sortable columns, as an allowlist.
 *
 * The sort field is interpolated into an ORDER BY clause, which cannot be
 * parameterised. Constraining it here with @IsIn means an unknown value is
 * rejected with a 400 before it ever reaches the query builder, so the
 * interpolation cannot become a SQL injection vector.
 */
export const SORTABLE_FIELDS = [
  'name',
  'description',
  'createdAt',
  'updatedAt',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

/** Matches the 4x3 card grid in the mockup. */
export const DEFAULT_PAGE_SIZE = 12;

/** Ceiling on page size, so one request cannot ask for an unbounded result set. */
export const MAX_PAGE_SIZE = 100;

export class ListServicesDto {
  /** 1-indexed, matching how the UI labels pages. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /**
   * Case-insensitive prefix match on service name.
   *
   * Trimmed, and an all-whitespace value collapses to undefined so that
   * `?search=` and `?search=%20` behave the same as omitting it entirely.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? undefined
      : value?.trim(),
  )
  search?: string;

  @IsOptional()
  @IsIn(SORTABLE_FIELDS)
  sort: SortableField = 'createdAt';

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'desc';
}
