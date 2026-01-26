/**
 * OpenTelemetry integration
 *
 * Deno has native OpenTelemetry support. This module re-exports the
 * OpenTelemetry API for use throughout the application.
 *
 * To enable OTEL collection:
 * - Set OTEL_DENO=true environment variable
 * - Optionally set OTEL_EXPORTER_OTLP_ENDPOINT (default: http://localhost:4318)
 *
 * See: https://docs.deno.com/runtime/fundamentals/open_telemetry/
 */

export { context, SpanStatusCode, trace } from "@opentelemetry/api";
export type { Span, Tracer } from "@opentelemetry/api";
