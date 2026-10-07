# Observability

[Back to 01-principles.md](01-principles.md) • [Back to 05-backend-api.md](05-backend-api.md) • [Back to 08-resilience.md](08-resilience.md) • [Back to 09-enforcement.md](09-enforcement.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0022-structured-logging-adapter.md](../documentation/adr/0022-structured-logging-adapter.md)

Load when starting a new project, service, or feature, and whenever touching logging, metrics, or tracing.

## It is designed in, not bolted on

Observability decided after an incident is a post-mortem action item. Observability decided before the first line of business logic is a feature that can be operated. Before writing the code, decide what questions this feature will need to answer in production: is it working, is it slow, who's using it, what breaks and how. The metrics, log events, and trace spans that answer those questions are part of the design, not an afterthought added once something goes wrong.

## Across every phase

- **Design**: name the questions this feature must answer in production before writing code. Decide which log events, metrics, and trace spans answer them.
- **Development**: instrument as you build. A feature without its logs, metrics, and traces is not finished, the same as a feature without its tests.
- **Testing**: write a test asserting the expected log, metric, or trace actually fires, on both the success and the failure path. Instrumentation nobody tested is as trustworthy as business logic nobody tested.
- **Deployment**: the dashboard and the alert for a feature exist before it reaches production traffic, not after the first incident.
- **Operation**: observability data feeds the next design phase. A recurring alert or an unexplained metric is a backlog item, not noise to mute.

## The three pillars

- **Structured logs with context**: `logger.info('Processing payment', { amount })`, not a bare string. Every log line for a request carries the correlation ID described in `08-resilience.md`, so a full session can be reassembled from log lines alone.
- **Metrics for the operations that matter**: counters, histograms, timers. Pick them at design time from the questions above, not by instrumenting everything and sorting it out later.
- **Tracing spans annotated with relevant attributes**, propagated across service and async boundaries. A trace that stops at the first `await` is not a trace, it's a single log line with extra steps. How errors get recorded onto a span, and how trace context survives a queue hop: `08-resilience.md`.

## Frontend is not exempt

User-facing code gets client-side error tracking and real-user monitoring, not just backend logs. An Error Boundary that only logs to the browser console is invisible the moment the user closes the tab. Route the caught error from `08-resilience.md`'s Error Boundary into the same observability pipeline as the backend.

## Enforcement

No PR ships new or changed behaviour without the logging, metrics, or tracing that lets someone answer the design-time questions for it. Checked in `09-enforcement.md` and in the definition of done in `CONTRIBUTING.md`.
