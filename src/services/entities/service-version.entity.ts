import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { Service } from './service.entity';

/**
 * A published release of a service, e.g. "v1.0.0" or "v2-beta".
 *
 * This is a set of concurrently available releases, not an auto-incrementing
 * revision history: consumers may depend on different versions at the same time.
 * The version string is user-defined per the brief ("versions; any string").
 *
 * Stored as a child table rather than a JSON column on `services` so the count
 * can be computed in SQL for the card grid, and so per-version metadata can be
 * added later without a data migration.
 */
@Entity('service_versions')
@Unique('uq_service_versions_service_version', ['serviceId', 'version'])
export class ServiceVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Postgres does not create an index for a foreign key automatically. Without
   * this, the LEFT JOIN behind versionCount degrades to a sequential scan of
   * service_versions on every list request.
   */
  @Index('idx_service_versions_service_id')
  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => Service, (service) => service.versions, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'service_id' })
  service: Service;

  @Column({ type: 'varchar', length: 100 })
  version: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
