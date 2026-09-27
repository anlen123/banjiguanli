#!/usr/bin/env bash
# Start from any working directory. Existing .env and data are preserved.
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/service-common.sh"
check_arguments "$@"
check_docker
prepare_environment
start_services
