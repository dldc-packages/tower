# Tower Docker image
FROM denoland/deno:2.6.6

WORKDIR /app

# Copy dependency files
COPY deno.json deno.lock* ./

# Copy source code
COPY . .

# Cache dependencies
RUN deno i

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

# Use denoland's existing ENTRYPOINT, only override CMD
CMD ["task", "command:serve"]
