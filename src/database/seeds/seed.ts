import { encodeDevToken } from '../../auth/dev-token';
import { Organization } from '../../services/entities/organization.entity';
import { ServiceVersion } from '../../services/entities/service-version.entity';
import { Service } from '../../services/entities/service.entity';
import dataSource from '../data-source';
import { SEED_ORGANIZATIONS, SeedOrganization } from './seed-data';

/**
 * Populates the database with the fixtures in seed-data.ts and prints ready-to-use
 * tokens.
 *
 * Idempotent: each run deletes the seeded organizations first, and the FK cascade
 * removes their services and versions. So `npm run seed` can be run repeatedly
 * without accumulating duplicates or tripping the unique name constraint.
 *
 * Everything happens in one transaction, so a failure leaves the database as it
 * was rather than half-seeded.
 */
async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource.transaction(async (manager) => {
      const seededOrgIds = SEED_ORGANIZATIONS.map((org) => org.id);

      // Cascades to services, and from there to service_versions.
      await manager.delete(Organization, seededOrgIds);

      for (const org of SEED_ORGANIZATIONS) {
        await manager.insert(Organization, { id: org.id, name: org.name });

        for (const svc of org.services) {
          const inserted = await manager.insert(Service, {
            organizationId: org.id,
            name: svc.name,
            description: svc.description,
          });

          const serviceId = inserted.identifiers[0].id as string;

          if (svc.versions.length > 0) {
            await manager.insert(
              ServiceVersion,
              svc.versions.map((version) => ({ serviceId, version })),
            );
          }
        }
      }
    });

    report();
  } finally {
    // Always release the pool, otherwise the process hangs instead of exiting.
    await dataSource.destroy();
  }
}

function serviceCount(org: SeedOrganization): number {
  return org.services.length;
}

function versionCount(org: SeedOrganization): number {
  return org.services.reduce((sum, svc) => sum + svc.versions.length, 0);
}

function report(): void {
  const line = '='.repeat(78);

  console.log(`\n${line}`);
  console.log('Seed complete');
  console.log(line);

  for (const org of SEED_ORGANIZATIONS) {
    console.log(
      `\n${org.name}\n` +
        `  organization id : ${org.id}\n` +
        `  services        : ${serviceCount(org)}\n` +
        `  versions        : ${versionCount(org)}`,
    );
  }

  console.log(`\n${line}`);
  console.log('Mock bearer tokens (unsigned - development only)');
  console.log(line);

  for (const org of SEED_ORGANIZATIONS) {
    const token = encodeDevToken({
      userId: org.userId,
      organizationId: org.id,
      email: `dev@${org.name.split(' ')[0].toLowerCase()}.example`,
    });

    console.log(`\n# ${org.name}`);
    console.log(
      `curl -s -H "Authorization: Bearer ${token}" \\\n` +
        `  "http://localhost:3000/api/v1/services?page=1&limit=12"`,
    );
  }

  console.log('');
}

seed().catch((error) => {
  console.error('\nSeed failed:', error);
  process.exit(1);
});
