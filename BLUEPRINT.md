# 🗼 Tower — Docker Compose Blueprint

---

## Overview

Tower is a declarative GitOps deployment orchestration tool for single-server infrastructure. Tower
itself runs as a service inside the Docker Compose stack (dogfooding). Deployments are declarative
via intent.json, with automatic semver→digest resolution, zero-downtime routing through Caddy, and
built-in observability.

- Language: TypeScript/Deno
- Package: JSR (@dldc/tower)
- Orchestrator: Docker + Docker Compose (Compose v2 plugin)
- Reverse proxy: Caddy (container)
- Observability: Grafana OTEL-LGTM (container)
- Image Registry: Docker Registry v2 (local, push-only from CI)
- Distribution: Global CLI via Deno; runtime as container inside the stack
- Networking: Docker bridge network; Caddy routes via Docker DNS

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
- Only Caddy exposes ports 80/443 to the host.
- All generated config (compose, Caddyfile, applied-intent) lives in `/var/infra`.

---

## Stack Layout (Files + Volumes)

```
/var/infra/
├── docker-compose.yml              # Generated: infra + app services
├── intent.json                     # Current intent (master config)
├── applied-intent.json             # Last applied intent with resolved digests
├── Caddyfile                       # Generated by Tower
└── credentials.json                # Hashed Basic Auth credentials
```

**Docker volumes/binds:**

- `/var/infra:/var/infra` bind-mounted into Tower container
- `/var/infra/Caddyfile:/etc/caddy/Caddyfile:ro` bind-mounted into Caddy container
- `/var/run/docker.sock:/var/run/docker.sock` into Tower container
- Named volumes: `caddy_data`, `caddy_config`, `otel_lgtm_data`, `registry_data`

---

## Intent Schema

Minimal intent.json structure for deployments:

```typescript
interface Intent {
  version: "1";
  adminEmail: string; // For Let's Encrypt ACME
  tower: {
    version: string; // e.g., "0.1.0"
    domain: string; // e.g., "tower.example.com"
  };
  registry: {
    domain: string; // e.g., "registry.example.com"
  };
  otel: {
    version: string; // e.g., "latest"
    domain: string; // e.g., "otel.example.com"
  };
  apps: Array<{
    name: string; // Unique app identifier
    image: string; // e.g., "registry.example.com/api:^1.2.0"
    domain: string; // e.g., "api.example.com"
    port: number; // App listening port (default: 3000)
    env?: Record<string, string>; // Environment variables
    secrets?: Record<string, string>; // Secret env vars
    healthCheck?: {
      path?: string; // HTTP path (e.g., "/health")
      port?: number; // Health check port
      interval?: number; // Seconds (default: 10)
      timeout?: number; // Seconds (default: 5)
      retries?: number; // Count (default: 3)
    };
  }>;
}
```

**Key Points:**

- `tower`, `registry`, and `otel` are required infrastructure sections
- `apps` array contains deployable services (can be empty initially)
- `image` uses semver ranges (e.g., `^1.2.0`) which Tower resolves to immutable digests
- `env` and `secrets` are both plain-text in intent.json (passed to containers as environment
  variables)
- `healthCheck` is optional; defaults shown above

---

## Credentials File

`/var/infra/credentials.json` stores Basic Auth hashes for Tower API and Registry push:

```json
{
  "tower": {
    "username": "tower",
    "password_hash": "$2b$12$..."
  },
  "registry": {
    "username": "ci",
    "password_hash": "$2b$12$..."
  }
}
```

Generated during `tower init` and never modified. Passwords printed once during init; store securely
in CI secrets.

---

## Compose Stack (Infra Services)

Tower generates/maintains a single compose file with:

- **caddy:** TLS termination, reverse proxy (only service exposing ports 80/443)
- **registry:** Docker Registry v2 (local image storage)
- **tower:** HTTP server (`/apply`, `/refresh`, `/status`); apply orchestration logic
- **otel-lgtm:** Grafana OTEL-LGTM (traces, logs, metrics, Grafana UI)
- **apps:** User-defined services (one per app in intent.json)

Example (simplified):

```yaml
version: "3.8"

services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - /var/infra/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [app_network]
    restart: unless-stopped

  tower:
    image: ghcr.io/dldc-packages/tower:0.1.0
    environment:
      - TOWER_DATA_DIR=/var/infra
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318/v1/traces
    volumes:
      - /var/infra:/var/infra
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [app_network]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/status"]
      interval: 10s
      timeout: 5s
      retries: 3

  registry:
    image: registry:2
    environment:
      - REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY=/var/lib/registry
      - REGISTRY_STORAGE_DELETE_ENABLED=true
    volumes: [registry_data:/var/lib/registry]
    networks: [app_network]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5000/v2/"]
      interval: 10s

  otel-lgtm:
    image: grafana/otel-lgtm:latest
    volumes: [otel_lgtm_data:/data]
    networks: [app_network]
    restart: unless-stopped

networks:
  app_network:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
  otel_lgtm_data:
  registry_data:
```

---

## Init Flow (Bootstrap)

`tower init` (CLI run once on the host) performs one-time bootstrap:

1. **Prompts for configuration**
   - Admin email (for Let's Encrypt ACME notifications)
   - Tower domain (e.g., `tower.example.com`)
   - Registry domain (e.g., `registry.example.com`)
   - OTEL domain (e.g., `otel.example.com`)

2. **Checks/installs prerequisites**
   - Docker Engine and Docker Compose plugin
   - Creates `/var/infra` directory structure

3. **Generates initial intent.json and credentials**
   - Creates `intent.json` with base configuration
   - Generates random passwords for Tower and Registry (stored as bcrypt hashes in
     `/var/infra/credentials.json`)

4. **Bootstraps the stack**
   - Calls internal apply logic with initial intent.json
   - Generates docker-compose.yml and Caddyfile
   - Runs `docker compose up -d`
   - Waits for all services to be healthy

5. **Prints summary**
   - Tower password (for `/apply` endpoint)
   - Registry password (for CI `docker push`)
   - Base intent.json
   - Example commands for next steps
   - Link to Grafana dashboard

After bootstrap, Tower is fully operational. All future deployments POST to
`https://<tower-domain>/apply`.

---

## Apply Flow (Inside Tower Container)

Tower is an HTTP server that processes deployment requests sequentially (single worker pattern).

1. **Validate:** Parse and validate intent.json against schema
2. **Resolve:** Query registry API for each app; match semver ranges to tags; get image digests
3. **DNS Check:** Extract new domains; validate DNS propagation (simple check via system resolver)
4. **Generate:**
   - Compose services for each app (merged with infra services)
   - Caddyfile routes for all domains
5. **Validate configs:**
   - `docker compose config` to lint generated compose
   - `caddy validate` on generated Caddyfile
6. **Apply:**
   - Write new docker-compose.yml and Caddyfile
   - Run `docker compose up -d` (idempotent: updates changed, leaves unchanged alone)
7. **Health checks:**
   - Wait for Docker healthchecks to report `healthy` for all services
   - If timeout → deployment fails (services stay at previous state)
8. **Reload Caddy:**
   - `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`
9. **Persist:**
   - Save applied-intent.json with resolved digests and timestamp
10. **Telemetry:**

- Emit OTEL spans for each step

---

## HTTP API

Tower exposes three endpoints (all require Basic Auth):

### POST /apply

- **Body:** `intent.json` (JSON)
- **Response:** Streaming text logs + final status
- **Status codes:** 200 (success), 500 (failure)
- Validates, resolves semver, generates configs, applies via docker compose, reloads Caddy

### POST /refresh

- **Body:** None (uses current intent from disk)
- **Response:** Streaming text logs + final status
- **Status codes:** 200 (success), 500 (failure)
- Re-resolves semver for current intent; applies only if digests changed

### GET /status

- **Response:** Plain text summary
- **Status codes:** 200 (success)
- Shows: applied intent timestamp, running services, health status, domains/routes

**Authentication:** Basic Auth header validated against credentials.json (bcrypt compare).

---

## Generators

### Compose Generator (`src/generators/compose.ts`)

- Input: Intent object
- Output: Complete docker-compose.yml with infra + app services
- Infra services (Caddy, Tower, Registry, OTEL-LGTM) use fixed configurations
- App services generated from intent.apps array:
  - `image`: Resolved to immutable digest (e.g., `sha256:abc123...`)
  - `environment`: Merged from `env` and `secrets` fields
  - `healthcheck`: Optional HTTP/TCP check
  - `networks`: [app_network]
  - `restart: unless-stopped`

### Caddy Generator (`src/generators/caddy.ts`)

- Input: Intent object + current Caddyfile (to detect new domains)
- Output: Complete Caddyfile with global config and route blocks
- Global config: `email` directive from intent.adminEmail (for Let's Encrypt)
- **Registry block:** `registry.domain` → `reverse_proxy registry:5000`
  - Basic Auth on write operations (POST, PUT, PATCH, DELETE on `/v2/*`)
  - No auth on read operations (GET)
- **Tower block:** `tower.domain` → `reverse_proxy tower:3100` with Basic Auth
- **OTEL block:** `otel.domain` → `reverse_proxy otel-lgtm:3000` (no auth)
- **App blocks:** `app.domain` → `reverse_proxy appname:port` (Docker DNS)

---

## Docker Registry Authentication

**For CI/CD (pushing):**

```bash
# Login once
docker login registry.example.com -u ci -p <password>

# Then push
docker push registry.example.com/api:1.2.3
```

**For Docker Compose (pulling):**

- Registry is exposed via Caddy without auth requirements on GET requests
- Docker daemon authenticates using credentials stored in `~/.docker/config.json` from the login
  above
- Tower container can pull images directly via Docker DNS (`registry:5000`) within the compose
  network
- Note: For internal pulls on the Docker network, no auth needed; external pulls (from host) use
  Caddy + Basic Auth

---

## DNS Validation

Before deploying a new domain, Tower validates DNS propagation:

1. Extract domains from current vs new intent.json (simple diff)
2. For each new domain:
   - Resolve using system resolver
   - Check if IP points to deployment server
3. Timeout: 30 seconds per domain
4. If validation fails: abort deployment with error message

Simple approach: no external APIs, just system resolver. User must ensure DNS is pre-configured
before deploy.

---

## Health & Restart Behavior

- **Restart policy:** `restart: unless-stopped` on all services
- **Docker backoff:** Exponential backoff on container crashes
- **Health checks:** Tower waits for all containers to report `healthy` state
- **Timeout:** Configurable per app (default: 30s)
- **Zero-downtime routing:** Caddy keeps old containers alive during health-check window; routes
  only to healthy backends
  - If new version fails health checks, old version continues serving traffic
  - Docker restart policies ensure failed containers retry automatically

---

## Security

- **Secrets:** Passed as environment variables to containers (from intent.json)
- **Logs:** Secrets redacted in all logs (Tower never logs env vars containing "secret", "password",
  "token", etc.)
- **Auth:** Basic Auth with bcrypt hashes; credentials stored in `/var/infra/credentials.json`
- **Socket access:** `/var/run/docker.sock` mounted only in Tower container
- **Bind mounts:** Limited to `/var/infra`
- **Network:** All services communicate via internal Docker network; only Caddy exposes ports to
  host

---

## Module Map

```
deno.json                          # Package manifest, exports, tasks
mod.ts                             # Re-exports types
src/
├── types.ts                       # Intent interface definition
├── cli/
│   ├── mod.ts                     # CLI entry point
│   ├── init.ts                    # Bootstrap (prompts, init, apply)
│   ├── apply.ts                   # Read intent from stdin; apply
│   ├── serve.ts                   # HTTP server (inside container)
│   └── cleanup.ts                 # Registry image cleanup
├── core/
│   ├── validator.ts               # Intent schema validation
│   ├── registry.ts                # Docker Registry HTTP client
│   ├── semver.ts                  # Semver range matching
│   ├── applier.ts                 # Orchestrate apply flow
│   ├── health.ts                  # Wait for container health
│   └── dns.ts                     # Validate DNS propagation
├── generators/
│   ├── compose.ts                 # Generate docker-compose.yml
│   ├── caddy.ts                   # Generate Caddyfile
│   └── templates/                 # Shared template helpers
├── otel/                          # Tracer setup, spans, context propagation
└── utils/
    ├── exec.ts                    # Run docker/compose/caddy commands
    ├── logger.ts                  # Logging with redaction
    ├── fs.ts                      # File system helpers
    ├── http.ts                    # HTTP client
    └── errors.ts                  # Custom error types
```

---

## Example: Base intent.json

```json
{
  "version": "1",
  "adminEmail": "admin@example.com",
  "tower": {
    "version": "0.1.0",
    "domain": "tower.example.com"
  },
  "registry": {
    "domain": "registry.example.com"
  },
  "otel": {
    "version": "latest",
    "domain": "otel.example.com"
  },
  "apps": [
    {
      "name": "api",
      "image": "registry.example.com/api:^1.2.0",
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

- `tower`, `registry`, `otel` are required infrastructure sections
- `apps` can be empty initially or contain multiple services
- `image` uses semver ranges (e.g., `^1.2.0`, `~1.2.3`, `1.2.*`)
- Tower resolves semver → latest matching tag → digest
- `env` and `secrets` both become container environment variables (just organizational)
- Health checks optional; defaults shown above

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

## Commands (Host)

```bash
# One-time bootstrap
sudo deno run -A jsr:@dldc/tower init

# Apply deployment
curl -u tower:PASSWORD \
  -X POST https://tower.example.com/apply \
  --data-binary @intent.json

# Refresh (re-resolve semver, apply if changed)
curl -u tower:PASSWORD \
  -X POST https://tower.example.com/refresh

# Check status
curl -u tower:PASSWORD https://tower.example.com/status
```

---

## Implementation Order

1. **Foundation:** repo structure, deno.json, types, mod.ts, README
2. **CLI skeleton:** cli/mod.ts, utils/logger.ts, utils/exec.ts
3. **Validation:** core/validator.ts (+ tests)
4. **Init flow:** intent template, prompts, bootstrap via apply
5. **Core:** registry client, semver, DNS validation, generators
6. **Apply:** health checks, applier, cli/apply.ts, cli/serve.ts
7. **Endpoints:** /apply, /refresh, /status
8. **Observability:** OTEL tracer, spans, propagation
9. **Cleanup:** cli/cleanup.ts (registry GC)
10. **Polish:** docs, examples, JSR publish
