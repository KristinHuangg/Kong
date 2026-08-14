/**
 * Seed fixtures.
 *
 * Organization and user ids are fixed rather than random so the tokens printed
 * by the seed stay valid across re-runs and can be pasted into the README.
 */

export const ACME_ORG_ID = '11111111-1111-4111-8111-111111111111';
export const NORTHWIND_ORG_ID = '22222222-2222-4222-8222-222222222222';

export const ACME_USER_ID = '33333333-3333-4333-8333-333333333333';
export const NORTHWIND_USER_ID = '44444444-4444-4444-8444-444444444444';

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Turpis non a, ' +
  'pellentesque ipsum aliquet id.';

export interface SeedService {
  name: string;
  description: string | null;
  versions: string[];
}

export interface SeedOrganization {
  id: string;
  name: string;
  userId: string;
  services: SeedService[];
}

/**
 * Acme has 14 services, matching the mockup's "0 — 11 of 14" pagination label,
 * so a default page of 12 leaves a second page of 2.
 *
 * Names deviate from the mockup in one way worth calling out: the mockup repeats
 * "Contact Us", "Notifications" and "Security", but the schema enforces unique
 * names per organization. The duplicates read as placeholder artwork rather than
 * a requirement (those same cards also show no description and an identical
 * version count), so the fixtures use distinct, related names instead.
 *
 * Version counts are varied rather than uniformly 3, and "Legacy SOAP Bridge"
 * deliberately has none: a service with zero versions must still appear in the
 * list with versionCount 0, which is what makes the LEFT JOIN necessary.
 */
export const SEED_ORGANIZATIONS: SeedOrganization[] = [
  {
    id: ACME_ORG_ID,
    name: 'Acme Corporation',
    userId: ACME_USER_ID,
    services: [
      {
        name: 'Locate Us',
        description: LOREM,
        versions: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
      },
      {
        name: 'Collect Monday',
        description: null,
        versions: ['v1.0.0', 'v1.2.0', 'v2.1.0'],
      },
      {
        name: 'Contact Us',
        description: 'Lorem ipsum dolor sit amet, consectetur adipiscing',
        versions: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
      },
      {
        name: 'Contact Us EU',
        description: 'Lorem ipsum dolor sit amet, consectetur adipiscing',
        versions: ['v1.0.0'],
      },
      {
        name: 'FX Rates International',
        description: 'Lorem ipsum dolor',
        versions: ['v1.0.0', 'v2.0.0', 'v3.0.0', 'v3.1.0'],
      },
      {
        name: 'FX Rates Domestic',
        description: LOREM,
        versions: ['v1.0.0', 'v2.0.0'],
      },
      {
        name: 'Notifications',
        description: null,
        versions: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
      },
      {
        name: 'Notifications Digest',
        description: null,
        versions: ['v0.9.0-beta', 'v1.0.0'],
      },
      {
        name: 'Priority Services',
        description: null,
        versions: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
      },
      {
        name: 'Reporting',
        description: LOREM,
        versions: ['v1.0.0', 'v2.0.0', 'v2.1.0', 'v2.2.0', 'v3.0.0'],
      },
      {
        name: 'Security',
        description: 'Lorem ipsum dolor',
        versions: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
      },
      {
        name: 'Security Audit',
        description: 'Lorem ipsum dolor',
        versions: ['v1.0.0'],
      },
      {
        name: 'Payments Gateway',
        description: LOREM,
        versions: ['v1.0.0', 'v2.0.0', 'v2.1.0'],
      },
      {
        name: 'Legacy SOAP Bridge',
        description: 'Deprecated. No published versions.',
        versions: [],
      },
    ],
  },
  {
    /**
     * A second tenant, used to prove isolation. Two of its services reuse Acme
     * names on purpose: uniqueness is scoped per organization, so this must be
     * legal, and neither org may ever see the other's rows.
     */
    id: NORTHWIND_ORG_ID,
    name: 'Northwind Traders',
    userId: NORTHWIND_USER_ID,
    services: [
      {
        name: 'Notifications',
        description: 'Northwind internal notifications.',
        versions: ['v1.0.0'],
      },
      {
        name: 'Locate Us',
        description: 'Northwind store locator.',
        versions: ['v1.0.0', 'v1.1.0'],
      },
      {
        name: 'Billing',
        description: 'Northwind billing service.',
        versions: ['v4.0.0'],
      },
    ],
  },
];
