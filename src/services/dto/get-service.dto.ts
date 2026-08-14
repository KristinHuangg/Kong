import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export const INCLUDABLE_RELATIONS = ['versions'] as const;

export type IncludableRelation = (typeof INCLUDABLE_RELATIONS)[number];

/**
 * Query options for the detail endpoint.
 *
 * `?include=versions` opts into the full versions array. Without it the response
 * carries only versionCount, which keeps the default payload small while
 * avoiding a second endpoint just to list versions.
 */
export class GetServiceQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsIn(INCLUDABLE_RELATIONS, {
    message: `include must be one of the following values: ${INCLUDABLE_RELATIONS.join(', ')}`,
  })
  include?: IncludableRelation;
}
