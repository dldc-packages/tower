# 🗼 Tower

Declarative GitOps deployment orchestration tool for single-server infrastructure.

Tower manages Docker Compose deployments with automatic semver→digest resolution, zero-downtime
routing through Caddy, and built-in observability.

## Features

- **Declarative deployments** via `intent.json`
- **Semver resolution** - specify version ranges, Tower resolves to immutable digests
- **Zero-downtime updates** - health checks + rolling updates via Docker Compose
- **TLS termination** - Automatic HTTPS via Caddy + Let's Encrypt
- **Built-in observability** - Grafana OTEL-LGTM stack (traces, logs, metrics)
- **Local registry** - Push from CI, pull during deployment
- **Portable intents** - Use `registry://` prefix to stay hostname-agnostic
- **GitOps ready** - POST intent from CI/CD pipelines

## Architecture

Tower runs as a containerized service inside your Docker Compose stack (dogfooding). All
infrastructure components (Caddy, Registry, OTEL) are managed together.

```
GitHub CI → Build & Push → Registry → Tower → Docker Compose → Apps
                                ↓
                            Caddy (HTTPS, routing)
                                ↓
                            OTEL-LGTM (observability)
```

## Quick Start

### 1. Bootstrap Tower (one-time)

```bash
# Install prerequisites and initialize Tower stack
sudo deno run -A jsr:@dldc/tower init
```

This will:

- Check Docker & Docker Compose installation
- Prompt for domains (tower, registry, OTEL)
- Generate credentials (printed once - save them!)
- Bootstrap the infrastructure stack
- Start all services (Caddy, Registry, Tower, OTEL)

### 2. Deploy an application

Create an `intent.json`:

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
      "image": "registry://api:^1.2.0",
      "domain": "api.example.com",
      "port": 3000,
      "env": {
        "NODE_ENV": "production"
      },
      "secrets": {
        "DATABASE_URL": "postgres://..."
      },
      "healthCheck": {
        "path": "/health",
        "interval": 10
      }
    }
  ]
}
```

**Portable registry prefix:** You can keep intents portable by using the `registry://` prefix in
`image` fields. Tower replaces `registry://` with the registry domain from your intent and rewrites
pulls to the in-cluster endpoint `registry:5000` during deployment, so Compose services fetch images
via the internal registry service without relying on external DNS/TLS.

Apply the deployment:

```bash
curl -u tower:PASSWORD \
  -H "Content-Type: application/json" \
  -X POST https://tower.example.com/apply \
  --data-binary @intent.json
```

### 3. CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Build and push
  run: |
    docker build -t registry.example.com/api:1.2.3 .
    docker login registry.example.com -u ci
    docker push registry.example.com/api:1.2.3

- name: Deploy
  run: |
    curl -u tower:${{ secrets.TOWER_PASSWORD }} \
      -X POST https://tower.example.com/apply \
      --data-binary @intent.json
```

## API Endpoints

- **POST /apply** - Deploy with new intent.json
- **POST /refresh** - Re-resolve semver for current intent
- **GET /status** - View deployment status

All endpoints require Basic Auth (credentials from `tower init`).

## Logging

- CLI init logs go to stdout only (text).
- The server duplicates apply/refresh logs to the HTTP stream and to console so they are captured
  when `OTEL_DENO_CONSOLE=capture` is set.

## Documentation

- [BLUEPRINT.md](./BLUEPRINT.md) - Complete architecture and implementation specification
- [Examples](./examples/) - Sample intent.json and CI workflows

## License

MIT

## Author

DLDC Packages
