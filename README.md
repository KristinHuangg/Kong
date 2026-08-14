# Service Catalog API

A read-focused Services API backing the service catalog dashboard from the
mockup: a paginated grid of service cards, each showing a name, a short
description and a version count, with search and a detail view.

Built with Postgres 15, Node 20, NestJS 9, TypeORM 0.3 and TypeScript.

---

## Quick start

Requires Node 20 and Docker.

```bash
cp .env.example .env       # defaults already match docker-compose.yml
npm install
docker compose up -d       # Postgres 15 on :5432
npm run migration:run
npm run seed               # prints ready-to-paste curl commands
npm run start:dev
```

The API listens on `http://localhost:3000/api/v1`.

`npm run seed` ends by printing a working `curl` for each seeded organization,
so you can copy one and get real data back immediately.

> Docker is not required. It is just the least painful way to get Postgres 15.
> The app talks to whatever `.env` points at, so a locally installed Postgres 15
> works identically.

### Running the tests

```bash
npm test          # 43 unit tests, no database needed
npm run test:e2e  # 60 integration tests against real Postgres
```

The integration suite shares the development database. Rather than truncating
tables, it creates two organizations of its own and removes only those. Since
every endpoint is organization-scoped, the assertions stay independent of
whatever else is in the database, and your seeded data survives the run.

---

## Authentication

Every endpoint requires `Authorization: Bearer <token>`. The organization is read
from the token's `organizationId` claim and is what scopes every query.

> **The token check is mocked.** Tokens have the three-segment shape of a JWT and
> carry real claims, but the signature is a fixed placeholder and is never
> verified, so anyone can mint a token for any organization. This is a scoped
> shortcut, not an oversight: the exercise asks for auth on the API, and the part
> worth reviewing is how identity flows into query scoping rather than how to
> operate a signing key.
>
> Production would replace one function call in `JwtAuthGuard` with
> `passport-jwt` verifying against the IdP's public key. Nothing downstream
> changes, because everything downstream depends only on the `AuthenticatedUser`
> interface. See `src/auth/dev-token.ts`.

---

## API

Base path `/api/v1`. All responses are JSON.

### `GET /services`

Lists the caller's services, newest first.

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `page` | integer | `1` | 1-indexed, minimum 1 |
| `limit` | integer | `12` | 1–100. Default matches the mockup's 4x3 grid |
| `search` | string | — | Case-insensitive prefix match on name |
| `sort` | enum | `createdAt` | `name`, `description`, `createdAt`, `updatedAt` |
| `order` | enum | `desc` | `asc` or `desc` |

```json
{
  "data": [
    {
      "id": "3f9a…",
      "name": "Locate Us",
      "description": "Lorem ipsum dolor sit amet…",
      "versionCount": 3,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 12, "total": 14, "totalPages": 2 }
}
```

`meta` carries everything the mockup's "0 — 11 of 14" label needs.

### `GET /services/:serviceId`

Returns one service. Powers the detail page reached by clicking a card.

By default the response is the same summary shape as a list item, carrying
`versionCount`. Add `?include=versions` to get the full version list instead:

```json
{
  "id": "3f9a…",
  "name": "Locate Us",
  "description": "Lorem ipsum dolor sit amet…",
  "versions": [
    { "id": "a1b2…", "version": "v1.0.0", "createdAt": "2026-01-01T00:00:00.000Z" }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

### `POST /services`

Outside the read-only core scope, included because the brief lists CRUD as an
optional consideration and the mockup has an "Add New Service" button.

```json
{
  "name": "Payments Gateway",
  "description": "Handles card payments",
  "versions": ["v1.0.0", "v1.1.0"]
}
```

Returns `201` with the created service and its versions. `name` is required and
capped at 255 characters; `versions` accepts any strings, deduplicated, up to 50.

### Status codes

| Code | When |
|------|------|
| `400` | Invalid query parameter, malformed UUID, unknown property in body |
| `401` | Missing, malformed, or non-bearer token |
| `404` | Service does not exist, **or belongs to another organization** |
| `409` | A service with that name already exists in the organization |

Validation failures list every offending field at once:

```json
{
  "statusCode": 400,
  "message": [
    "page must not be less than 1",
    "limit must not be greater than 100"
  ],
  "error": "Bad Request"
}
```

### Examples

```bash
TOKEN=<paste from npm run seed>

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/services?page=1&limit=12"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/services?search=Loc"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/services?sort=name&order=asc"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/services/<id>?include=versions"
```

---

## Data model

```
organizations ──1:N──> services ──1:N──> service_versions
```

```sql
services           (id, organization_id, name, description, created_at, updated_at)
service_versions   (id, service_id, version, created_at)
```

Both child relationships are `ON DELETE CASCADE`. Timestamps are `timestamptz`,
so they carry an instant rather than a wall-clock reading.

### Indexes

```sql
-- Unique per organization, not globally. Also serves the tenant filter
-- and ORDER BY name, so no separate index is needed for either.
CONSTRAINT uq_services_org_name UNIQUE (organization_id, name)

-- Postgres does not index foreign keys automatically. Without this, the
-- LEFT JOIN behind versionCount degrades to a sequential scan per request.
CREATE INDEX idx_service_versions_service_id ON service_versions (service_id);

-- Case-insensitive prefix search. See "Search" below for why it is built
-- over lower(name) rather than name.
CREATE INDEX idx_services_org_lower_name
  ON services (organization_id, lower(name) varchar_pattern_ops);
```

There is deliberately **no** index on `created_at` or `updated_at`. At a few
thousand services per organization Postgres sorts in memory in about a
millisecond, and each extra index costs write throughput. Worth revisiting near
~50k services per organization.

---

## Design decisions

### Versions are a table, not a JSON column

The count has to be computable in SQL for the card grid, and per-version
metadata (published date, deprecation flag, changelog) is a plausible next
request. A `UNIQUE (service_id, version)` constraint also comes for free, which
a JSON array cannot express.

Versions are user-defined strings per the brief ("versions; any string"), so
there is no semver validation. They model concurrently available releases rather
than a revision history: consumers may depend on different versions at once.

### Version counts come from one JOIN, not a query per card

`GET /services` issues a single `LEFT JOIN` with `COUNT(v.id)` grouped by
service, so page size never drives query count. `LEFT` rather than `INNER`
matters: a service with no versions must still appear with `versionCount: 0`.
The seed data includes exactly such a service, and a test asserts it.

`COUNT` is cast with `::int` because the driver returns `bigint` as a string to
avoid precision loss, and the API contract promises a number.

### Search: `lower(name) LIKE`, not `ILIKE`

The obvious way to write case-insensitive prefix search is `name ILIKE 'term%'`.
That is a trap. `varchar_pattern_ops` only accelerates case-*sensitive* `LIKE`;
`ILIKE` cannot use such an index at all. Confirmed with `EXPLAIN`:

```
-- lower(name) LIKE lower($1) || '%'
Index Scan using idx_services_org_lower_name
  Index Cond: (organization_id = … AND lower(name) ~>=~ 'loc' AND lower(name) ~<~ 'lod')
  cost=0.14..8.19

-- name ILIKE $1 || '%'
Index Scan using idx_services_org_lower_name
  Index Cond: (organization_id = …)
  Filter: (name ~~* 'Loc%')          <-- checked per row
  cost=0.14..12.42
```

In the first plan the prefix becomes a range scan inside the index. In the
second the name match is a post-filter, so Postgres reads every service in the
organization and tests them one at a time. Invisible at 14 rows; a full tenant
scan on every keystroke at 50k.

So the index is built over `lower(name)` and the query matches that expression
exactly. A unit test asserts the predicate contains `lower(s.name) LIKE` and not
`ILIKE`, because this is easy to "simplify" back into a performance bug.

User input is escaped, so typing `%` or `_` searches for those characters rather
than acting as a wildcard.

Search is name-only. In a catalog, people look for services they already know by
name; descriptions here are frequently absent or placeholder text, so matching
them would produce confusing results. Fuzzy or description search would mean
`pg_trgm` with a GIN index, which is a reasonable next step but not warranted
without evidence that users want it.

### Offset pagination

The mockup shows "0 — 11 of 14", which requires a total count and the ability to
jump to a page. Cursor pagination provides neither. Offset degrades at deep
pages, but that only starts to matter well beyond this data size, and the fix
(switch to cursors, or cap reachable pages) is available later.

Every ordering appends `id` as a tie-breaker. Without it, rows with equal sort
values can come back in a different order per request, which makes offset
pagination silently skip or repeat records between pages. There is a test that
fetches two adjacent pages and asserts no overlap.

### Tenant isolation

`organization_id` comes from the token, never from a query parameter or request
body, and is part of the `WHERE` clause rather than a check applied afterwards.

A service belonging to another organization therefore returns `404`, not `403`.
`403` would confirm the record exists, which is an information leak. The
`forbidNonWhitelisted` validation setting also rejects an `organizationId` sent
in a request body, so a caller cannot create a service inside someone else's
tenant.

### Response shapes are explicit

Entities are never serialised straight to JSON. Mapper functions in
`dto/service-response.dto.ts` build the response objects, so `organizationId`
cannot leak and the public contract does not shift when the ORM mapping changes.

### Migrations, not `synchronize`

`synchronize` is `false` everywhere. It silently drops columns and cannot express
a functional index with a non-default operator class, which this schema depends
on. The initial migration is hand-written for the same reason, and its `down`
path has been exercised, not just written.

### One module, no CQRS split

Read and write share one controller and one service. The core scope is
read-only; splitting them would add deployment surface and buy nothing at this
size. The service class is the seam if a write path ever needs to scale
independently.

---

## Assumptions and trade-offs

**Service names are unique per organization.** This is the one place the
implementation knowingly departs from the mockup, which repeats "Contact Us",
"Notifications" and "Security". Those duplicates read as placeholder artwork
rather than intent, since the same cards also show no description and an
identical version count. Uniqueness gives a meaningful `409` and lets the
database enforce the rule instead of application code. If duplicates are
genuinely wanted, drop the constraint and the `409` handling with it. Worth
confirming with the product owner.

**Fewer than ~10k services per organization.** Drives the offset pagination and
the absent sort indexes. Both decisions have documented upgrade paths.

**Tokens are issued elsewhere.** No login, signup or refresh. The API validates
claims and scopes queries.

**A user belongs to one organization at a time.** The token carries a single
`organizationId`. Multi-org membership would switch org context by re-issuing a
token, keeping the API stateless.

**The detail view is a page, not a modal.** It is deep-linkable, the back button
returns to the grid, and a long version list gets its own scroll context.

---

## Testing

103 tests: 43 unit, 60 integration.

Unit tests mock the repositories and cover this service's own logic: pagination
arithmetic, the search predicate, tenant scoping, error translation, response
shapes, and the token decoder's failure modes (which are a security boundary, so
they are asserted to fail closed).

Integration tests run real HTTP through Nest, TypeORM and Postgres with nothing
mocked. That is where the SQL itself gets verified: the aggregate, the search
predicate, the organization filter, the unique constraint, and cross-page
stability.

The integration suite earned its keep during development by catching a real bug.
`ValidationPipe` was configured with `enableImplicitConversion: true`, which
coerces values to their declared TypeScript type — so a body of `{ "name": 42 }`
became `"42"`, passed `@IsString()`, and returned `201` instead of `400`. The
option is now off, and the query parameters that genuinely need coercion declare
`@Type(() => Number)` explicitly instead.

### What I would add next

- **Rate limiting.** `@nestjs/throttler`, roughly 100 req/min per user on list.
  Left out as configuration rather than design.
- **`PATCH` and `DELETE`.** The create path establishes the pattern; delete needs
  a soft-delete decision first, since services have consumers.
- **OpenAPI.** `@nestjs/swagger` would generate a browsable spec from the
  existing DTOs at low cost.
- **A load test.** The performance claims here rest on `EXPLAIN` plans and small
  datasets. I would want numbers from a seeded 50k-row table before repeating
  them anywhere that matters.

---

## Project layout

```
src/
├── auth/                  Mock bearer auth: guard, token codec, @CurrentUser
├── common/                Pagination envelope
├── config/                Env validation, shared TypeORM options
├── database/
│   ├── migrations/        Hand-written initial schema
│   └── seeds/             Idempotent seed + fixtures
└── services/
    ├── dto/               Request validation and response contracts
    ├── entities/          Organization, Service, ServiceVersion
    ├── services.controller.ts
    └── services.service.ts
test/
└── services.e2e-spec.ts   Integration suite
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests |
| `npm run test:e2e` | Integration tests (needs Postgres running) |
| `npm run lint` | ESLint + Prettier |
| `npm run migration:run` | Apply migrations |
| `npm run migration:revert` | Roll back the last migration |
| `npm run seed` | Reset seed data and print tokens |
