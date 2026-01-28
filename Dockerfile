# Tower Docker image
FROM denoland/deno:2.6.6

WORKDIR /app

# Install Docker CLI and Docker Compose plugin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY deno.json deno.lock* ./

# Copy source code
COPY . .

# Cache dependencies
RUN deno install

# Create non-root user and ensure deno cache is writable
RUN useradd -m -u 1000 tower && \
    chown -R tower:tower /app && \
    mkdir -p /deno-dir && \
    chown -R tower:tower /deno-dir && \
    groupadd -f docker && \
    usermod -aG docker tower

# Note: Tower needs access to /var/run/docker.sock
# The tower user is added to the docker group to access the socket

USER tower

# Expose Tower HTTP API
EXPOSE 3000

# Set environment defaults
ENV TOWER_DATA_DIR=/var/infra \
    TOWER_PORT=3000

# Use denoland's existing ENTRYPOINT, only override CMD
CMD ["task", "command:serve"]
