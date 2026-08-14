import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Service } from './service.entity';

/**
 * Tenant boundary. Every service belongs to exactly one organization, and every
 * query in this API is filtered by the caller's organization id.
 *
 * Modelled as a real table rather than an opaque id on `services` so the schema
 * can enforce tenancy with a foreign key instead of relying on application code
 * to never forget the filter.
 */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @OneToMany(() => Service, (service) => service.organization)
  services: Service[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
