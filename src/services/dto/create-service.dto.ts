import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Guards against a single request inserting an unreasonable number of rows. */
export const MAX_VERSIONS_PER_CREATE = 50;

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  /**
   * Version strings are user-defined per the brief ("versions; any string"),
   * so no semver validation. Each is length-capped to match the column, and
   * duplicates within the request are collapsed rather than rejected: asking
   * for the same version twice is harmless, not an error worth a 400.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  @ArrayMaxSize(MAX_VERSIONS_PER_CREATE)
  @Transform(({ value }) =>
    Array.isArray(value)
      ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim() : v)))]
      : value,
  )
  versions?: string[];
}
