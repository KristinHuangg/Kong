import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: organizations, services, service_versions.
 *
 * Written by hand rather than via `migration:generate` because the search index
 * this schema depends on is a functional index with a non-default operator
 * class, and TypeORM's @Index decorator cannot express either.
 *
 * gen_random_uuid() is built into Postgres 13+, so no pgcrypto extension is
 * needed on our target of Postgres 15.
 */
export class InitialSchema1786060800000 implements MigrationInterface {
  name = 'InitialSchema1786060800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id"         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"       varchar(255) NOT NULL,
        "created_at" timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "services" (
        "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid         NOT NULL,
        "name"            varchar(255) NOT NULL,
        "description"     text,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "updated_at"      timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_services_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        -- Names are unique per organization, not globally. Also gives us a
        -- btree on (organization_id, name), which serves both the tenant
        -- filter and ORDER BY name, so no separate index is needed for those.
        CONSTRAINT "uq_services_org_name" UNIQUE ("organization_id", "name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_versions" (
        "id"         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_id" uuid         NOT NULL,
        "version"    varchar(100) NOT NULL,
        "created_at" timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_service_versions_service"
          FOREIGN KEY ("service_id") REFERENCES "services" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "uq_service_versions_service_version"
          UNIQUE ("service_id", "version")
      )
    `);

    /**
     * Postgres does not index foreign keys automatically. The list endpoint
     * LEFT JOINs service_versions to count versions per service, so without
     * this the join falls back to a sequential scan on every request.
     */
    await queryRunner.query(`
      CREATE INDEX "idx_service_versions_service_id"
        ON "service_versions" ("service_id")
    `);

    /**
     * Case-insensitive prefix search index.
     *
     * Two details matter here and are easy to get wrong:
     *
     * 1. varchar_pattern_ops is what lets a btree serve LIKE 'term%'. Under the
     *    default operator class, a LIKE pattern cannot use the index unless the
     *    database happens to be in the C locale.
     *
     * 2. It only applies to case-SENSITIVE LIKE. ILIKE cannot use it at all.
     *    So the index is built over lower("name") and the query must compare
     *    lower("name") LIKE lower($1) || '%' to match this expression.
     *
     * Leading with organization_id keeps the tenant filter and the prefix match
     * satisfiable from a single index.
     */
    await queryRunner.query(`
      CREATE INDEX "idx_services_org_lower_name"
        ON "services" ("organization_id", lower("name") varchar_pattern_ops)
    `);

    /**
     * Deliberately omitted: indexes on created_at / updated_at for sorting.
     * At a few thousand services per organization Postgres sorts in memory in
     * about a millisecond, and each extra index costs write throughput and
     * storage. Revisit if an organization approaches ~50k services.
     */
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_services_org_lower_name"`);
    await queryRunner.query(`DROP INDEX "idx_service_versions_service_id"`);
    await queryRunner.query(`DROP TABLE "service_versions"`);
    await queryRunner.query(`DROP TABLE "services"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
  }
}
