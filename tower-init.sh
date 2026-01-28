#!/bin/bash

# Tower Init Script
# This script prompts for configuration and runs Docker-based Tower initialization
# No Deno required on the host machine

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TOWER_IMAGE="${TOWER_IMAGE:-ghcr.io/dldc-packages/tower:latest}"
MIN_PASSWORD_LENGTH=16

# Check if running with sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run with sudo${NC}"
   exit 1
fi

echo -e "${GREEN}🗼 Tower Initialization${NC}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "Collecting configuration..."
echo ""

# Prompt for admin email
read -p "Admin email (for Let's Encrypt ACME notifications): " ADMIN_EMAIL
if [[ ! "$ADMIN_EMAIL" =~ @ ]] || [[ ! "$ADMIN_EMAIL" =~ \. ]]; then
    echo -e "${RED}❌ Please enter a valid email address${NC}"
    exit 1
fi

# Prompt for Tower domain
read -p "Tower domain (e.g., tower.example.com): " TOWER_DOMAIN
if [[ -z "$TOWER_DOMAIN" ]]; then
    echo -e "${RED}❌ Tower domain is required${NC}"
    exit 1
fi

# Prompt for Registry domain
read -p "Registry domain (e.g., registry.example.com): " REGISTRY_DOMAIN
if [[ -z "$REGISTRY_DOMAIN" ]]; then
    echo -e "${RED}❌ Registry domain is required${NC}"
    exit 1
fi

# Prompt for OTEL domain
read -p "OTEL/Grafana domain (e.g., otel.example.com): " OTEL_DOMAIN
if [[ -z "$OTEL_DOMAIN" ]]; then
    echo -e "${RED}❌ OTEL domain is required${NC}"
    exit 1
fi

echo ""

# Prompt for Tower password
while true; do
    read -s -p "Tower password (min $MIN_PASSWORD_LENGTH characters): " TOWER_PASSWORD
    echo ""
    if [[ ${#TOWER_PASSWORD} -lt $MIN_PASSWORD_LENGTH ]]; then
        echo -e "${RED}❌ Password must be at least $MIN_PASSWORD_LENGTH characters${NC}"
    else
        break
    fi
done

# Confirm Tower password
read -s -p "Confirm Tower password: " TOWER_PASSWORD_CONFIRM
echo ""
if [[ "$TOWER_PASSWORD" != "$TOWER_PASSWORD_CONFIRM" ]]; then
    echo -e "${RED}❌ Passwords do not match${NC}"
    exit 1
fi

echo ""

# Prompt for Registry password
while true; do
    read -s -p "Registry password (min $MIN_PASSWORD_LENGTH characters): " REGISTRY_PASSWORD
    echo ""
    if [[ ${#REGISTRY_PASSWORD} -lt $MIN_PASSWORD_LENGTH ]]; then
        echo -e "${RED}❌ Password must be at least $MIN_PASSWORD_LENGTH characters${NC}"
    else
        break
    fi
done

# Confirm Registry password
read -s -p "Confirm Registry password: " REGISTRY_PASSWORD_CONFIRM
echo ""
if [[ "$REGISTRY_PASSWORD" != "$REGISTRY_PASSWORD_CONFIRM" ]]; then
    echo -e "${RED}❌ Passwords do not match${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Configuration collected${NC}"
echo ""
echo "Running Tower initialization..."
echo ""

# Pull the latest image to avoid using stale cache
echo "Pulling Tower image: $TOWER_IMAGE"
docker pull "$TOWER_IMAGE"

# Log image info for debugging
echo ""
echo "Docker image: $TOWER_IMAGE"
docker image inspect "$TOWER_IMAGE" --format='  Version: {{.Config.Labels.version}}{{- if eq .Config.Labels.version ""}} (not set){{end}}'
echo ""

# Run docker with all the environment variables
# Run as root since init needs to write to deno cache and docker socket
docker run --rm -it \
    --user root \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/infra:/var/infra \
    -e "ADMIN_EMAIL=$ADMIN_EMAIL" \
    -e "TOWER_DOMAIN=$TOWER_DOMAIN" \
    -e "REGISTRY_DOMAIN=$REGISTRY_DOMAIN" \
    -e "OTEL_DOMAIN=$OTEL_DOMAIN" \
    -e "TOWER_PASSWORD=$TOWER_PASSWORD" \
    -e "REGISTRY_PASSWORD=$REGISTRY_PASSWORD" \
    "$TOWER_IMAGE" \
    task command:init

if [[ $? -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}✓ Tower initialization complete!${NC}"
else
    echo ""
    echo -e "${RED}❌ Tower initialization failed${NC}"
    exit 1
fi
