# Backend & API Standards

[Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Load when touching routes, controllers, services, or database access.

## Security

- Validate every external input with a Zod schema before use. No raw `req.body` reaches business logic.
- Enforce authorisation via guards/middleware (`@UseGuards`, route middleware), not repeated manual `if (!user.isAdmin)` checks scattered through handlers.

## Observability

Full rules and lifecycle checklist: `14-observability.md`. Every backend feature ships with structured logs, metrics, and tracing before it reaches production, carrying the correlation ID described in `08-resilience.md` so a request can be traced end to end.

## Data integrity

- Wrap multi-step mutations in a database transaction.
- Make writes idempotent: check an idempotency key before creating, return the existing result on replay.

## API versioning

**Default to URI path versioning** (`/api/v1/users`, `/api/v2/users`). It's explicit, cache-friendly, and simplest to route and test. Header or Accept-header versioning are acceptable alternatives for A/B testing or strict content negotiation, but path versioning is the default choice.

- Version the entire API surface at once. Never version endpoints inconsistently (`/api/users` next to `/api/v2/orders`).
- Business logic lives once in `shared/services/`; version-specific folders (`v1/`, `v2/`) hold only the controllers, routes, and schemas that adapt the shared logic to that version's contract.
- Never put the version in a query parameter or a date. Use the path or a header.
- Adding optional fields or new endpoints is non-breaking. Removing/renaming a field, changing its type, or changing a URL is breaking and needs a new version.
- Deprecated versions get `Warning`, `Sunset`, and `Link` (migration guide) response headers, and a sunset date at least 6 months out. After sunset, return `410 Gone`.
- Lifecycle stages: beta → stable → deprecated → sunset.

## RESTful design

- URLs are resource nouns, plural, kebab-case for multi-word resources: `/api/blog-posts/:id`, not `/api/getBlogPost`.
- Keep nesting shallow - 2–3 levels max (`/api/orders/:id/items`, not four levels deeper).

| Method | Safe | Idempotent | Use for                                     |
| ------ | ---- | ---------- | ------------------------------------------- |
| GET    | yes  | yes        | read - never causes a side effect           |
| POST   | no   | no         | create, or any action with a side effect    |
| PUT    | no   | yes        | replace the full resource                   |
| PATCH  | no   | usually    | partial update                              |
| DELETE | no   | yes        | remove - repeat calls end in the same state |

- Non-idempotent POSTs with real consequences (payments, orders) require an `Idempotency-Key` header, checked against a store before processing.
- Filtering, sorting, and pagination are query parameters, with a hard cap on `limit` (e.g. 100) so clients can't request unbounded pages.
- Long-running work returns `202 Accepted` with a status URL to poll, not a blocking request.
- Bulk operations get a dedicated endpoint (`/users/bulk-create`) with an explicit size cap (e.g. 1000 items), not an unbounded loop of single creates.
- Include HATEOAS links where the available next actions depend on resource state (e.g. `cancel` only appears while an order is `pending`).
