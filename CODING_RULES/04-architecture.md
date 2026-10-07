# Architecture

[Back to 12-domain-duplication-audit.md](12-domain-duplication-audit.md) • [Back to 13-testing-strategy.md](13-testing-strategy.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0003-generator-pipeline-seams.md](../documentation/adr/0003-generator-pipeline-seams.md) • [Back to 0022-structured-logging-adapter.md](../documentation/adr/0022-structured-logging-adapter.md) • [Back to 0045-discovery-follows-the-root-gitignore.md](../documentation/adr/0045-discovery-follows-the-root-gitignore.md) • [Back to HLD.md](../documentation/HLD.md) • [Back to TESTING.md](../documentation/TESTING.md)

Load when touching module boundaries, dependency wiring, data access, or multi-step workflows.

## Architecture tests are mandatory

Every architectural decision needs a matching `arch-unit-ts` (or an equivalent architecture-boundary test - see `src/__tests__/architecture/dependency-direction.test.ts` for this repo's substitute) test under `__tests__/architecture/`. An architecture rule without a test isn't enforced - it will drift.

Required coverage:
- Dependency direction between layers (e.g. domain must not depend on infrastructure).
- Naming conventions per folder (e.g. everything in `repositories/` matches `*Repository`).
- Module boundary rules (e.g. controllers only depend on services, types, utils).
- Third-party library isolation (see Adapter pattern below).

## Adapter pattern for third-party libraries

Any library with real footprint in the codebase (payment providers, cloud SDKs, etc.) sits behind an interface owned by this codebase. Application code depends on the interface, never on the library directly.

```typescript
export interface PaymentGateway {
	createPayment(amount: number): Promise<string>;
}

export class StripeAdapter implements PaymentGateway {
	async createPayment(amount: number) {
		/* stripe-specific call */
	}
}

// consumer depends on the interface, not on Stripe
class PaymentService {
	constructor(private gateway: PaymentGateway) {}
}
```

Why: swap the library without touching business logic, mock the interface instead of the SDK in tests, and contain breaking upstream changes to one file.

## Dependency injection

Pass dependencies through the constructor. Don't `new` a hard dependency inside a class - it can't be tested or swapped.

## Repository pattern

Data access goes through a repository interface (`UserRepository.findById`, `.save`), not raw queries scattered through services.

## State machines for domain workflows

Multi-step business processes - payment lifecycle, order lifecycle, onboarding, approvals, multi-step forms - are modelled as a finite state machine (e.g. XState), not as a combination of boolean flags and status enums. Flags and enums allow invalid state combinations; an FSM doesn't.
