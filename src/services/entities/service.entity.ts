import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { Organization } from './organization.entity';
import { ServiceVersion } from './service-version.entity';

/**
 * A catalog entry: the thing rendered as a card in the dashboard grid.
 */
@Entity('services')
// Service names are unique per organization, not globally. Two different orgs
// may both have a service called "Notifications". Enforced in the database so
// concurrent creates cannot both succeed.
@Unique('uq_services_org_name', ['organizationId', 'name'])
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * No standalone index here on purpose. The uq_services_org_name unique
   * constraint already creates a btree on (organization_id, name), whose
   * leading column serves organization-only filters and ORDER BY name.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (organization) => organization.services, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * Nullable on purpose. The mockup shows several cards with no description,
   * so the absence of one is a valid state rather than an empty string.
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * cascade is deliberately left off. Versions are written explicitly by the
   * create flow inside a transaction, which keeps the write path obvious and
   * avoids TypeORM issuing surprise inserts when a Service is saved.
   */
  @OneToMany(() => ServiceVersion, (version) => version.service)
  versions: ServiceVersion[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
