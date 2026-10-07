# Error Handling & Resilience

[Back to 05-backend-api.md](05-backend-api.md) • [Back to 14-observability.md](14-observability.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0022-structured-logging-adapter.md](../documentation/adr/0022-structured-logging-adapter.md)

Load when touching error handling, external calls, or anything expected to fail sometimes.

## Backend

Centralise error handling: a typed `AppError` (statusCode, message, `isOperational`) thrown from business logic, caught by a single global error-handling middleware. Operational errors return their own status and message; anything unexpected is logged in full and returns a generic `500` - never leak internals to the client.

## Frontend

Wrap route- or section-level trees in a React Error Boundary. Log the caught error and its component stack in `componentDidCatch`; render a fallback UI, not a blank screen.

## Design for failure

- **Circuit breaker** around calls to flaky external services: stop calling after repeated failures, retry after a cooldown, close again on success.
- **Retry with exponential backoff** for transient failures (network blips, rate limits) - not an unbounded or immediate retry loop.

## Traceable errors across a session

An error handled in isolation, with no link back to the session that produced it, is a dead end for whoever debugs it later. This has two parts: giving every error the identifiers to reconstruct its session, and making sure those identifiers land in one unified trace rather than scattered, disconnected records.

### Correlation across retries and boundaries

- Every error carries the identifiers needed to reconstruct its session: a request or correlation ID, and a trace ID if tracing is in use. Attach these when the error is created, not only when it's finally logged - an error can cross a retry or an async boundary before that happens.
- When wrapping or rethrowing an error, preserve the original as its cause (`new AppError('payment failed', { cause: err })`). Don't swallow the underlying error or the context it carried; a wrapped error with no cause is a fresh mystery for the next person.
- Propagate the same correlation ID across every retry and circuit-breaker attempt. Five retries of one request should read as one traceable session in the logs, not five unrelated errors.

### Unified error tracing

A correlation ID in a log line is not the same thing as a unified trace. The error also has to be recorded against the trace itself, and the trace has to stay one trace across every hop, or the session still fragments into disconnected pieces that happen to share an ID.

- When an error occurs inside an active span, record it on that span, don't just log it separately: `span.recordException(err); span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })`. A caught-and-logged error that never touches the span is invisible in the trace view, even with the right correlation ID in the log line next to it.
- Propagate the W3C Trace Context (`traceparent` header) across every HTTP hop, so a request spanning several services is one trace, not one per service.
- Async work has no HTTP header to carry the context. Embed the trace context in the message or job payload itself when publishing to a queue or scheduling a background job, and re-hydrate it before the worker starts its span. Without this, an error thrown three retries and one queue hop later shows up as an orphaned trace with no link back to the request that caused it.
- A frontend error caught by the Error Boundary (`Frontend`, above) joins the same trace as the request it happened during, rather than landing only in a separate client-side error tool. If the frontend and backend end up in different tools, correlate them by the shared trace ID so one can be found from the other.
- Structured logs (`14-observability.md`) include the correlation and trace identifiers on every line, so a trace tool or a log search can pull an entire session together from one ID either way.


