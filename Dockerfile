# Tower Docker image
FROM denoland/deno:2.1.4

WORKDIR /app

# Copy dependency files
COPY deno.json deno.lock* ./

# Cache dependencies
RUN deno install --entrypoint src/cli/mod.ts

# Copy source code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 tower && \
    chown -R tower:tower /app

# Note: Tower needs access to /var/run/docker.sock
# This is mounted at runtime, not copied into image

USER tower

# Expose Tower HTTP API
EXPOSE 3100

# Set environment defaults
ENV TOWER_DATA_DIR=/var/infra \
    TOWER_PORT=3100

# Run Tower HTTP server
CMD ["deno", "run", "--allow-all", "src/cli/mod.ts", "serve"]
