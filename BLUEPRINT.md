# 🗼 Tower — Docker Compose Blueprint

---

## Overview

Tower is a declarative GitOps deployment orchestration tool for single-server infrastructure. Tower
itself runs as a service inside the Docker Compose stack (dogfooding). Deployments are declarative
via intent.json, with automatic semver→digest resolution, zero-downtime routing through Caddy, and
built-in observability.

- **Language:** TypeScript/Deno
- **Package:** JSR (@dldc/tower)
- **Version:** 0.1.23+
- **Orchestrator:** Docker + Docker Compose (Compose v2 plugin)
- **Reverse proxy:** Caddy (container)
- **Observability:** Grafana OTEL-LGTM (container with native Deno OTEL support)
- **Image Registry:** Docker Registry v2 (local, push from CI)
- **Distribution:** Docker image (ghcr.io/dldc-packages/tower); runtime as container inside stack
- **Networking:** Docker bridge network; Caddy routes via Docker DNS

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    GitHub CI (Private Repo)                  │
│  1) Build Docker image                                       │
│  2) Push to registry (Basic Auth)                            │
│  3) Generate intent.json (TypeScript)                        │
│  4) Inject secrets from GitHub Actions                       │
│  5) POST to Tower domain via HTTPS (Basic Auth + TLS)        │
└──────────┬───────────────────┬───────────────────────────────┘
           │ HTTPS (push)      │ HTTPS (deploy)
           ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Deployment Server                        │
│  ┌────────────────────────────────────────────────────┐     │
│  │ Caddy (container, ports 80/443)                    │     │
│  │  - TLS termination, reverse proxy                  │     │
│  │  - Routes registry.domain → registry:5000          │     │
│  │    (push: Basic Auth; pull: no auth)               │     │
│  │  - Routes tower.domain → tower:3100 (Docker DNS)   │     │
│  │  - Routes app.domain → appname:PORT (Docker DNS)   │     │
│  │  - Routes otel.domain → otel-lgtm:3000 (Docker DNS)│     │
│  └───────────────────┬────────────────────────────────┘     │
│                      │ Docker network: app_network          │
│         ┌────────────┼────────────┐                         │
│         ▼            ▼            ▼                         │
│  ┌──────────┐ ┌─────────────┐ ┌──────────────┐              │
│  │ Registry │ │   Tower     │ │ OTEL-LGTM    │              │
│  │ :5000    │ │   :3100     │ │ :3000        │              │
│  └────┬─────┘ └──────┬──────┘ └──────┬───────┘              │
│       │              │               │                      │
│       │ Docker pulls │               │                      │
│       │              ▼               ▼                      │
│       │       ┌─────────────┐ ┌─────────────┐               │
│       └──────→│ Docker      │ │Observability│               │
│               │  Compose    │ │(Traces/Logs)│               │
│               └──────┬──────┘ └─────────────┘               │
│                      │                                      │
│                      ▼                                      │
│               ┌─────────────┐                               │
│               │    Apps     │                               │
│               │ (containers)│                               │
│               └─────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

**Notes:**

- All services run in Docker Compose on a shared `app_network` bridge network.
- Tower container mounts `/var/run/docker.sock` to control Docker and run `docker compose` commands.
- Registry stores images locally; CI pushes images, Docker Compose pulls during deployment.
- Caddy routes via Docker DNS (e.g., `reverse_proxy tower:3100`) — no host port mapping needed.
- Only Caddy exposes ports 80/443 to the host; the admin API listens on 2019 but is kept internal
  (not published).
- All generated config (compose, Caddy JSON, intent) lives in `/var/infra`.

---

## Stack Layout (Files + Volumes)

All Tower infrastructure state is stored in `/var/infra/`:

```
/var/infra/
├── docker-compose.yml              # Generated: all services (infra + apps)
├── intent.json                     # Last applied intent with resolved digests & timestamp
├── Caddy.json                      # Generated: Caddy config (routes, TLS, auth)
└── .docker-compose.yml.tmp         # Temporary file for validation (cleaned up after)
```

**Bind mounts:**

- `/var/infra:/var/infra` → Tower container (read/write config and state)
- `/var/infra/Caddy.json:/etc/caddy/Caddy.json:ro` → Caddy (read-only config)
- `/var/run/docker.sock:/var/run/docker.sock` → Tower only (Docker control)

**Named volumes:**

- `caddy_data` → Caddy (TLS certs, cache)
- `caddy_config` → Caddy (runtime state)
- `otel_lgtm_data` → OTEL (traces, logs)
- `registry_data` → Registry (image storage)

---

## Intent Schema

The intent.json structure for deployments:

```typescript
interface Intent {
  version: "1";
  adminEmail: string; // For Let's Encrypt ACME
  dataDir?: string; // Optional, defaults to /var/infra
  tower: {
    version: string; // e.g., "0.1.23"
    domain: string; // e.g., "tower.example.com"
    username: string; // API username (e.g., "tower")
    passwordHash: string; // Bcrypt hash
  };
  registry: {
    domain: string; // e.g., "registry.example.com"
    username: string; // e.g., "ci"
    passwordHash: string; // Bcrypt hash
  };
  otel: {
    version: string; // e.g., "latest"
    domain: string; // e.g., "otel.example.com"
    username: string; // e.g., "admin"
    passwordHash: string; // Bcrypt hash
  };
  apps: Array<{
    name: string; // Unique app identifier
    image: string; // e.g., "registry://api:^1.2.0" or "registry.example.com/api:^1.2.0"
    domain: string; // e.g., "api.example.com"
    port?: number; // App listening port (default: 3000)
    env?: Record<string, string>; // Environment variables
    secrets?: Record<string, string>; // Secret env vars (redacted in logs)
    healthCheck?: {
      path?: string; // HTTP path (e.g., "/health")
      port?: number; // Health check port (defaults to app.port)
      interval?: number; // Seconds (default: 10)
      timeout?: number; // Seconds (default: 5)
      retries?: number; // Count (default: 3)
    };
  }>;
}
```

**Key Points:**

- `version` is always `"1"`
- `tower`, `registry`, and `otel` are required infrastructure sections with embedded credentials
- `apps` array contains deployable services (can be empty initially)
- `image` uses semver ranges (e.g., `^1.2.0`, `~1.2.3`, `1.2.*`, `1.2.3`) which Tower resolves to
  immutable digests
- `registry://` prefix for portable images: `registry://myapp:^1.0.0` resolves to the registry
  domain from intent
- `env` and `secrets` are both passed to containers (secrets are just marked sensitive for logging)
- `healthCheck` is optional; defaults shown above
- Credentials are bcrypt hashes (generated during `tower init`)

**Image Reference Examples:**

- `registry://api:^1.2.0` - Portable, uses intent.registry.domain
- `registry.example.com/api:^1.2.0` - Explicit domain
- `registry.example.com/api:1.2.3` - Exact version
- `registry.example.com/api@sha256:abc...` - Immutable digest (no resolution needed)

---

## Credentials in Intent

Credentials are now embedded in the intent.json as bcrypt password hashes. There is no separate
`credentials.json` file. During init, hashed credentials are generated and embedded in the intent.

```json
{
  "tower": {
    "username": "tower",
    "passwordHash": "$2b$12$..."
  },
  "registry": {
    "username": "ci",
    "passwordHash": "$2b$12$..."
  },
  "otel": {
    "username": "admin",
    "passwordHash": "$2b$12$..."
  }
}
```

**Generation:** During `tower init`, passwords are hashed with bcrypt and stored in the intent.

---

## Compose Stack (Generated Services)

Tower generates a docker-compose.yml with infrastructure and user app services:

### Infrastructure Services

**caddy (Caddy 2 reverse proxy)**

- Image: `caddy:2`
- Ports: 80:80, 443:443 (only service exposing host ports)
- Volumes: Config (read-only), data, config
- Health check: Admin API /health
- Command: Caddy with JSON adapter

**tower (Tower orchestration)**

- Image: `ghcr.io/dldc-packages/tower:0.1.23` (or current version)
- Port: 3100 (internal only)
- Volumes: /var/infra (config), /var/run/docker.sock (Docker control)
- Health check: GET /status
- Environment: TOWER_DATA_DIR, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_DENO flags

**registry (Docker Registry v2)**

- Image: `registry:2`
- Port: 5000 (internal only, exposed via Caddy)
- Volume: registry_data (persistent storage)
- Health check: /v2/ endpoint
- Config: DELETE enabled, filesystem storage

**otel-lgtm (Grafana OTEL-LGTM)**

- Image: `grafana/otel-lgtm:latest` (or specified version)
- Port: 3000 (internal only, exposed via Caddy)
- Volume: otel_lgtm_data (persistent traces/logs)
- Health check: / endpoint
- Includes: Grafana UI, Loki, Tempo, OpenTelemetry Collector

### User App Services

Generated from intent.apps array:

- **Image:** Resolved to immutable digest (e.g., `registry:5000/myapp@sha256:abc...`)
- **Port:** app.port (default: 3000)
- **Environment:** env + secrets + OTEL_EXPORTER_OTLP_ENDPOINT
- **Networks:** app_network (Docker DNS resolution)
- **Restart:** unless-stopped
- **Health check:** Optional HTTP check (if app.healthCheck.path provided)

### Networking

- **Network:** app_network (bridge driver)
- **DNS:** Docker internal DNS allows `service:port` resolution (e.g., `tower:3100`)
- **Isolation:** No external access except through Caddy (ports 80/443)

### Persistent Volumes

- **caddy_data:** TLS certificates and cache
- **caddy_config:** Runtime configuration
- **registry_data:** Docker image layers and manifests
- **otel_lgtm_data:** Traces, logs, metrics storage

### Bind Mounts

- **/var/infra:** Intent.json, docker-compose.yml, Caddy.json (shared across services)
- **/var/run/docker.sock:** Into Tower only (Docker socket for control)

### Example Generated docker-compose.yml

Generated services are YAML v3.8 format with all infrastructure services pre-configured. User apps
are merged into the same file with consistent settings (networks, restart policy, health checks).

---

## Init Flow (Bootstrap)

`tower init` performs one-time bootstrap of the infrastructure stack:

### Via Docker (Recommended)

Run the init command using Docker with environment variables:

```bash
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/infra:/var/infra \
  -e ADMIN_EMAIL=admin@example.com \
  -e TOWER_DOMAIN=tower.example.com \
  -e REGISTRY_DOMAIN=registry.example.com \
  -e OTEL_DOMAIN=otel.example.com \
  -e TOWER_PASSWORD=your_secure_password_min_16_chars \
  -e REGISTRY_PASSWORD=your_secure_password_min_16_chars \
  ghcr.io/dldc-packages/tower:latest task command:init
```

### Init Process

1. **Check prerequisites**
   - Docker Engine and Docker Compose plugin installation
   - Docker socket accessibility

2. **Load configuration**
   - Read from environment variables (ADMIN_EMAIL, TOWER_DOMAIN, REGISTRY_DOMAIN, OTEL_DOMAIN)
   - Validate domains and email format

3. **Hash credentials**
   - Read passwords from environment (TOWER_PASSWORD, REGISTRY_PASSWORD)
   - Hash with bcrypt (minimum 16 characters)
   - Generate OTEL credentials using registry password

4. **Generate initial intent.json**
   - Create intent with embedded hashed credentials
   - Tower version set to package version from deno.json
   - OTEL version defaults to "latest"
   - Apps array starts empty

5. **Generate and validate production configs**
   - Generate docker-compose.yml with infra + app services
   - Generate Caddy.json with ACME automation and routes
   - Validate Caddy.json format
   - Validate DNS resolution for all domains (with 30s timeout)

6. **Start the production stack**
   - Save intent.json and compose file to `/var/infra`
   - Run `docker compose up -d --wait`
   - Wait for all services to reach healthy state

7. **Print summary**
   - Display generated intent.json
   - Show next steps (configure DNS, wait for SSL, etc.)
   - Print links to Tower and Grafana dashboards

After bootstrap, Tower is fully operational at `https://<tower-domain>/apply`.

---

## Apply Flow (Inside Tower Container)

Tower server processes POST /apply requests sequentially:

1. **Validate intent**
   - Parse JSON body as Intent
   - Validate against schema (valibot)
   - Check app names, domains, constraints
   - Throw ValidationError if invalid

2. **Resolve services**
   - Combine infrastructure (Caddy, Registry, Tower, OTEL) with user apps
   - Normalize image references (rewrite `registry://` to domain, then to internal service)
   - Build ResolvedService array

3. **Resolve semver ranges**
   - For each app with semver range in image tag
   - Query registry `/v2/<repo>/tags/list`
   - Match range against available tags (^, ~, wildcards)
   - Resolve matched tag to immutable digest via `/v2/<repo>/manifests/<tag>`
   - Build Map<appName, fullDigestReference>

4. **Validate DNS**
   - Collect all unique domains from services
   - For each domain, resolve via Deno.resolveDns (30s timeout)
   - Fail deployment if any domain doesn't resolve

5. **Generate configs**
   - Compose: Generate docker-compose.yml (YAML format)
   - Caddy: Generate Caddy JSON config (v2.x with ACME, routes, auth)

6. **Validate generated configs**
   - Write compose to temp file
   - Run `docker compose config -q` (validate syntax)
   - If valid, write final file; if invalid, abort

7. **Apply via Docker Compose**
   - Run `docker compose up -d --wait`
   - Blocks until all services report healthy
   - If timeout, fail and keep previous state

8. **Reload Caddy**
   - POST Caddy JSON to admin API `/load`
   - Caddy validates and applies atomically
   - If invalid, keeps current config and returns error

9. **Save applied intent**
   - Write intent.json with resolved digests and timestamp
   - Save to `/var/infra/intent.json`

**Streaming Response:**

- Each step logs progress to stdout
- HTTP response streams logs as text/plain (chunked encoding)
- Logger redacts secrets in all output

---

## HTTP API

Tower exposes three endpoints (all require Basic Auth via Caddy):

### POST /apply

- **Body:** `intent.json` (JSON)
- **Response:** Streaming text (plain/text)
- **Status codes:** 200 (success), 400 (invalid intent), 500 (failure)
- **Purpose:** Deploy with a new or updated intent.json
- **Details:**
  - Validates intent structure and constraints
  - Resolves semver ranges to immutable digests
  - Validates DNS propagation for all domains
  - Generates docker-compose.yml and Caddy.json
  - Applies via `docker compose up -d --wait`
  - Reloads Caddy configuration via admin API
  - Saves resolved intent to `/var/infra/intent.json`

### POST /refresh

- **Body:** Empty (reads current intent from disk)
- **Response:** Streaming text (plain/text)
- **Status codes:** 200 (success), 404 (no intent), 500 (failure)
- **Purpose:** Re-resolve semver ranges for current intent
- **Details:**
  - Re-queries registry for latest tags matching semver ranges
  - Re-resolves to latest digests
  - Applies only if digests changed (idempotent)
  - Updates Compose and Caddy configs if needed

### GET /status

- **Response:** Plain text summary
- **Status codes:** 200 (success)
- **Purpose:** View deployment status
- **Details:**
  - Shows applied intent timestamp and app count
  - Lists all services (infra + apps) with health status
  - Lists all domains and their TLS status
  - Example output:
    ```
    Tower Status
    ============================================================

    Applied: 2026-01-28T10:30:45.123Z
    Apps: 1

    Services:
      caddy: running (healthy)
      registry: running (healthy)
      tower: running (healthy)
      otel-lgtm: running (healthy)
      api: running (healthy)

    Domains:
      🔒 tower.example.com → tower:3100
      🔒 registry.example.com → registry:5000
      🔒 otel.example.com → otel-lgtm:3000
      🔒 api.example.com → api:3000
    ```

**Authentication:** All endpoints use Basic Auth validated by Caddy. Credentials from intent:

```bash
curl -u tower:PASSWORD https://tower.example.com/apply
```

Tower username/password are set during `tower init` and embedded in intent.json.

---

## Generators

### Compose Generator (`src/generators/compose.ts`)

Generates a complete docker-compose.yml with infrastructure and app services.

**Input:** Intent with resolved images

**Output:** YAML string (generated by @std/yaml stringify)

**Infrastructure services:**

- **caddy:** Caddy 2 reverse proxy (ports 80/443, admin API on 2019 internal)
- **registry:** Docker Registry v2 (port 5000 internal)
- **tower:** Tower HTTP server (port 3100 internal)
- **otel-lgtm:** Grafana OTEL-LGTM (port 3000 internal)

**App services (generated from intent.apps):**

- `image`: Resolved to immutable digest (e.g., `registry:5000/myapp@sha256:abc123...`)
- `environment`: Merged from `env` and `secrets` fields + OTEL_EXPORTER_OTLP_ENDPOINT
- `healthcheck`: Optional HTTP/TCP check from healthCheck config
- `networks`: [app_network] (shared bridge network)
- `restart: unless-stopped`

**Features:**

- All services on isolated app_network (Docker DNS resolution)
- Named volumes for stateful services (caddy_data, caddy_config, otel_lgtm_data, registry_data)
- Bind mount /var/infra into Tower for config access and docker.sock for orchestration
- Health checks for all services (Caddy, Tower, Registry, OTEL)

### Caddy Generator (`src/generators/caddy.ts`)

Generates Caddy JSON config with automatic TLS and routing.

**Input:** Resolved services + admin email

**Output:** Caddy JSON config (v2.x JSON adapter format)

**Features:**

- ACME automation with Let's Encrypt (email for notifications)
- Automatic HTTPS (redirects HTTP to HTTPS)
- Domain-based routing via reverse proxy
- Authentication policies (configurable per service):
  - `none`: Open access (apps, OTEL)
  - `basic_all`: All requests require auth (Tower)
  - `basic_write_only`: Only write methods (POST, PUT, PATCH, DELETE) require auth (Registry)

**Authentication:**

- Credentials embedded in ResolvedService.authBasicUsers
- Caddy validates against bcrypt hashes from intent
- Policy is scoped: protect /v2/* for registry writes only

**Route generation:**

- One route per domain + service
- Reverse proxy to upstream container via Docker DNS
- Terminal routes prevent fallthrough
- Routes for Tower, Registry, OTEL, and user apps

### ResolvedService Type (`src/core/types.ts`)

Unifies infrastructure and user apps into a consistent structure for downstream processing.

**Properties:**

- `name`: Service name
- `type`: "infra" or "app"
- `domain`: Primary domain for routing
- `port`, `version`, `image`: Service metadata
- `upstreamName`, `upstreamPort`: Docker DNS service and port for reverse proxy
- `authPolicy`: Authentication requirement
- `authBasicUsers`: Bcrypt hashes for Basic Auth
- `authScopes`: Optional path/method restrictions for scoped auth
- `env`, `secrets`: Environment variables
- `healthCheck`: Health check configuration

---

## Docker Registry Authentication

### For CI/CD (Pushing Images)

During init, a registry password is generated and stored as bcrypt hash in intent.json.

```bash
# CI script
docker login registry.example.com -u ci -p $REGISTRY_PASSWORD
docker build -t registry.example.com/myapp:1.2.3 .
docker push registry.example.com/myapp:1.2.3
```

Credentials used: `registry.username` and `registry.passwordHash` from intent.json.

### For Docker Compose (Pulling Images)

**Internal pulls (from Tower container):**

- Tower can pull from internal registry service (`registry:5000`) via Docker DNS
- No authentication needed on the internal Docker network
- Images are automatically rewritten to `registry:5000/...` during generation

**External pulls (from CI/CD):**

- Registry is exposed via Caddy with public read access (HTTP GET not authenticated)
- Basic Auth (Basic Auth) protects write operations (POST, PUT, PATCH, DELETE) on `/v2/*`
- Docker daemon stores credentials in `~/.docker/config.json` from login

### Image Reference Rewriting

During deployment, Tower normalizes image references:

```javascript
// Portable syntax
"image": "registry://myapp:^1.0.0"
// ↓ Rewritten to
"image": "registry.example.com/myapp:^1.0.0"
// ↓ Resolved to
"image": "registry.example.com/myapp:1.2.3"
// ↓ Rewritten for internal pull
"image": "registry:5000/myapp:1.2.3" (in compose file)
// ↓ Resolved to digest
"image": "registry:5000/myapp@sha256:abc123..." (final)

---

## DNS Validation

Before applying a deployment, Tower validates DNS propagation:

1. Collect all unique domains from services (Tower, Registry, OTEL, and apps)
2. For each domain, attempt DNS resolution using Deno.resolveDns
3. Retry every 2 seconds for up to 30 seconds per domain
4. If all domains resolve successfully, proceed with deployment
5. If any domain fails to resolve, abort with error

**Purpose:** Ensure DNS records point to the deployment server before TLS setup. Caddy will fail to
obtain Let's Encrypt certificates if domains don't resolve.

**Implementation:** `src/core/dns.ts` uses native Deno DNS resolution (no external APIs).

---

## Health Checks & Restart Behavior

### Docker Compose Health Checks

All services include health checks:

- **Caddy:** `curl -f http://localhost:2019/health` (admin API)
- **Tower:** `curl -f http://localhost:3100/status`
- **Registry:** `wget --spider -q http://localhost:5000/v2/`
- **OTEL:** `wget --spider -q http://localhost:3000/`
- **Apps:** Optional HTTP path check (from app.healthCheck.path)

### Wait Policy

`docker compose up -d --wait` blocks until all services report healthy state. If a service doesn't
reach healthy within timeout, deployment fails and previous state is kept.

### Restart Policy

All services use `restart: unless-stopped`:
- Services automatically restart on crash
- Docker applies exponential backoff
- Explicit stop (docker-compose down) prevents restart

### Zero-Downtime Routing

Caddy keeps old containers alive during health-check window:
- New version starts alongside old
- Caddy routes only to healthy backends
- If new version fails health checks, old version continues serving
- No user-facing downtime during deployments

---

## Security

### Secrets Management

- **Secrets in intent.json:** Passed as environment variables to containers
- **Log redaction:** Logger redacts keys/values containing "password", "secret", "token", "key", "auth"
- **Secret format:** Non-sensitive (env) and sensitive (secrets) are both passed to containers
- **No persistence:** Secrets are not written to disk (except in intent.json during deployment)

### Authentication

- **Basic Auth:** Caddy validates requests with bcrypt hash comparison
- **Credentials:** Tower, Registry, and OTEL usernames/password hashes embedded in intent.json
- **Generation:** Passwords hashed with bcrypt (@felix/bcrypt) during init
- **Minimum:** 16-character passwords required

### Access Control

- **Docker socket:** Only Tower container mounts `/var/run/docker.sock`
- **File access:** Tower binds `/var/infra` (contains intent.json with hashed credentials)
- **Network:** All services on isolated Docker network; only Caddy exposes ports 80/443
- **Admin API:** Caddy admin API (port 2019) is internal only (not published to host)

### TLS & HTTPS

- **Automatic HTTPS:** Caddy uses Let's Encrypt ACME for domain auto-enrollment
- **Admin email:** Provided during init (for Let's Encrypt notifications)
- **HTTP redirect:** All HTTP traffic redirected to HTTPS (307 Temporary Redirect)
- **Certificate renewal:** Automatic (Caddy handles expiration checks and renewal)

### Image Resolution

- **Digest verification:** Tower resolves semver tags to immutable digests
- **Pull by digest:** Docker Compose uses immutable digests to ensure consistent pulls
- **Registry auth:** Basic Auth protects write operations to registry (POST, PUT, PATCH, DELETE)
- **Read-only pull:** Public read access for pulling (no auth required)

---

## Logging & Observability

### Logger

Tower uses a custom pluggable logger with secret redaction:

- **Default:** Console output (text format)
- **Redaction:** Automatically redacts sensitive keys (password, secret, token, key, auth, credential)
- **Sinks:** Supports multiple output destinations (console, stream/HTTP response)
- **Format:** Text (human-readable) or JSON (structured)

### Init Logging

- Logs go to stdout only (text format)
- No stream sink (blocking operation)
- Shows progress: prerequisites → config → hashing → generation → apply → summary

### Server Logging

- Console sink: captures logs to local output
- Stream sink: duplicates logs to HTTP response stream (for /apply and /refresh)
- Logger scope: Both console and stream receive all messages
- Secrets redacted in both outputs

### OpenTelemetry Integration

Tower supports native Deno OTEL:

- **OTEL_DENO=true:** Enable OTEL in runtime
- **OTEL_DENO_CONSOLE=capture:** Capture console logs as OTEL (shown in Grafana)
- **OTEL_EXPORTER_OTLP_ENDPOINT:** Default `http://otel-lgtm:4318/v1/traces`

User apps should also export OTEL telemetry to the same endpoint for full observability stack.

### Grafana Dashboard

Access at `https://<otel.domain>/` (credentials from intent.json):

- **Grafana UI:** Visualize traces, logs, metrics
- **Loki:** Store and query logs
- **Tempo:** Store and query traces
- **Prometheus:** Metrics collection (optional)

---

## Module Map
```

deno.json # Package manifest, exports, tasks mod.ts # Re-exports Intent and other types src/ ├──
config.ts # Configuration constants (DEFAULT_PORT, DEFAULT_DATA_DIR) ├── types.ts # Intent, App,
HealthCheck, AppliedIntent, DeploymentStatus ├── cli/ │ ├── init.ts # Bootstrap command (entry point
for tower init) │ └── serve.ts # HTTP server (entry point for tower serve) ├── core/ │ ├── types.ts

# ResolvedService, BasicAuthUser, AuthScope │ ├── validator.ts # Intent schema validation

(valibot-based) │ ├── registry.ts # Docker Registry v2 HTTP client │ ├── semver.ts # Semver range
matching (@semver/semver-like) │ ├── applier.ts # Apply orchestration (validates, resolves,
generates, applies) │ ├── deployer.ts # Shared deployment utilities (resolve services, normalize
images) │ ├── health.ts # Get container health status via docker inspect │ ├── dns.ts # Validate DNS
propagation │ └── caddyAdmin.ts # Caddy admin API client (POST /load endpoint) ├── generators/ │ ├──
compose.ts # Generate docker-compose.yml (@std/yaml stringify) │ └── caddy.ts # Generate Caddy JSON
config (v2.x JSON adapter) ├── otel/ │ └── mod.ts # Re-export OpenTelemetry API (@opentelemetry/api)
└── utils/ ├── errors.ts # Custom error types (TowerError, ValidationError, etc.) ├── exec.ts #
Execute commands (docker, compose, etc.) ├── fs.ts # File system helpers (read/write JSON, ensure
dir) └── http.ts # HTTP client (request, getJson, postJson, basicAuth)

````
**Key Dependencies:**
- `@std/cli`: Parse CLI arguments
- `@std/yaml`: Stringify compose config
- `@valibot/valibot`: Intent schema validation
- `@felix/bcrypt`: Hash/verify passwords
- `@opentelemetry/api`: Native Deno OTEL support
- Deno built-ins: Deno.run, Deno.serve, Deno.resolveDns

---

## Example: Base intent.json

After `tower init`, the generated base intent looks like:

```json
{
  "version": "1",
  "adminEmail": "admin@example.com",
  "tower": {
    "version": "0.1.23",
    "domain": "tower.example.com",
    "username": "tower",
    "passwordHash": "$2b$12$..."
  },
  "registry": {
    "domain": "registry.example.com",
    "username": "ci",
    "passwordHash": "$2b$12$..."
  },
  "otel": {
    "version": "latest",
    "domain": "otel.example.com",
    "username": "admin",
    "passwordHash": "$2b$12$..."
  },
  "apps": []
}
````

To deploy an app, add to the `apps` array:

```json
{
  "apps": [
    {
      "name": "api",
      "image": "registry://api:^1.2.0",
      "domain": "api.example.com",
      "port": 3000,
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      },
      "secrets": {
        "DATABASE_URL": "postgres://user:pass@host/db",
        "API_KEY": "secret-key-here"
      },
      "healthCheck": {
        "path": "/health",
        "port": 3000,
        "interval": 10,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

**Notes:**

- Use `registry://` prefix for portable intents (automatically rewritten to intent.registry.domain)
- `image` semver ranges (^, ~, wildcards) are resolved to latest matching tag → digest
- `env` and `secrets` are both passed to container (just organizational distinction)
- Health checks optional; defaults: interval=10s, timeout=5s, retries=3
- All infrastructure credentials are bcrypt hashes (not plain-text passwords)

---

## CI/CD Workflow

Tower integrates with any CI/CD system. The typical workflow:

### 1. Build & Push Image

```yaml
# Example: GitHub Actions
name: Deploy

on:
  push:
    branches: [main]
    tags: ["v*"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Extract version
        id: version
        run: |
          if [[ "$GITHUB_REF" == refs/tags/* ]]; then
            VERSION=${GITHUB_REF#refs/tags/v}
          else
            VERSION="0.0.0-${GITHUB_SHA::7}"
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Build image
        run: |
          docker build -t registry.example.com/api:${{ steps.version.outputs.version }} .
          docker tag registry.example.com/api:${{ steps.version.outputs.version }} \
            registry.example.com/api:${{ github.sha }}

      - name: Push to registry
        run: |
          echo "${{ secrets.REGISTRY_PASSWORD }}" | \
            docker login registry.example.com -u ci --password-stdin
          docker push registry.example.com/api:${{ steps.version.outputs.version }}
          docker push registry.example.com/api:${{ github.sha }}

      - name: Generate intent
        run: |
          # TypeScript script to generate intent.json
          # Update image version for the app
          deno run -A scripts/generate-intent.ts \
            --app api \
            --version "^${{ steps.version.outputs.version }}"

      - name: Deploy to Tower
        run: |
          curl -u tower:${{ secrets.TOWER_PASSWORD }} \
            -H "Content-Type: application/json" \
            -X POST https://tower.example.com/apply \
            --data-binary @intent.json
```

### 2. Image Tagging Strategy

- **Commit SHA:** `registry.example.com/api:a1b2c3d` (immutable)
- **Semver:** `registry.example.com/api:1.2.3` (for intent)
- **Intent references:** Use semver ranges `^1.2.0` → Tower resolves to latest matching tag → digest

### 3. Registry Authentication

**Push (CI/CD):**

```bash
docker login registry.example.com -u ci
# Password from Tower init (saved in CI secrets)
```

**Pull (Docker Compose):**

- No authentication required for pulls
- Registry configured via Caddy with public read access
- Docker daemon automatically pulls from `registry.example.com` during `docker compose up`

### 4. Semver Resolution Flow

1. CI pushes `registry.example.com/api:1.2.3`
2. Intent specifies `"image": "registry.example.com/api:^1.2.0"`
3. Tower queries registry `/v2/api/tags/list`
4. Tower filters tags matching semver range `^1.2.0`
5. Tower selects latest (e.g., `1.2.3`)
6. Tower resolves `1.2.3` → `sha256:abc123...` digest
7. Compose file uses immutable digest: `registry.example.com/api@sha256:abc123...`
8. Docker pulls from local registry

---

## Commands

### Bootstrap Tower (One-time)

```bash
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/infra:/var/infra \
  -e ADMIN_EMAIL=admin@example.com \
  -e TOWER_DOMAIN=tower.example.com \
  -e REGISTRY_DOMAIN=registry.example.com \
  -e OTEL_DOMAIN=otel.example.com \
  -e TOWER_PASSWORD=min_16_character_password \
  -e REGISTRY_PASSWORD=min_16_character_password \
  ghcr.io/dldc-packages/tower:latest task command:init
```

### Deploy with New Intent

```bash
curl -u tower:PASSWORD \
  -H "Content-Type: application/json" \
  -X POST https://tower.example.com/apply \
  --data-binary @intent.json
```

### Refresh Deployment

```bash
curl -u tower:PASSWORD \
  -X POST https://tower.example.com/refresh
```

### Check Status

```bash
curl -u tower:PASSWORD https://tower.example.com/status
```

### View Grafana Dashboard

```
https://otel.example.com/
```

**Note:** All curl commands require Basic Auth with username from intent.json and the password you
set during init.

---

## Implementation Status

This is the current state of Tower v0.1.23:

### ✅ Completed

1. **Foundation:** repo structure, deno.json, types.ts, mod.ts, README
2. **CLI:**
   - `init.ts`: Bootstrap command (environment-driven, Docker-based)
   - `serve.ts`: HTTP server with /apply, /refresh, /status endpoints
3. **Core Modules:**
   - `validator.ts`: Valibot-based intent validation with custom rules
   - `registry.ts`: Docker Registry v2 HTTP client (list tags, get digest)
   - `semver.ts`: Semver range matching (^, ~, wildcards, exact)
   - `applier.ts`: Complete apply orchestration flow
   - `deployer.ts`: Service resolution and image normalization
   - `health.ts`: Docker container health status via docker inspect
   - `dns.ts`: DNS propagation validation (Deno.resolveDns)
   - `caddyAdmin.ts`: Caddy admin API integration
4. **Generators:**
   - `compose.ts`: Docker Compose YAML generation (@std/yaml)
   - `caddy.ts`: Caddy JSON config (v2.x with ACME, routes, auth policies)
5. **Utilities:**
   - `exec.ts`: Command execution (docker, compose)
   - `fs.ts`: File system operations
   - `http.ts`: HTTP client with Basic Auth
   - `errors.ts`: Custom error types
6. **Configuration:**
   - Dockerfile: Multi-stage Deno image with Docker/Compose CLI
   - GitHub Actions: Docker publish workflow
   - tower-init.sh: Bash init script (for systems without Deno)
7. **Documentation:**
   - README.md: Quick start and features
   - This BLUEPRINT.md: Architecture and design

### Future Enhancements (v0.2+)

- **Registry cleanup:** Garbage collection of old image tags
- **Advanced monitoring:** Custom health check providers (TCP, exec)
- **Multi-server:** Federation/clustering support
- **CLI distribution:** JSR publish + standalone binaries
- **Backup/restore:** Configuration snapshots and rollback
- **Advanced auth:** OAuth2, JWT, OIDC for services
