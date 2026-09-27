#!/usr/bin/env bash
# Stop services without deleting containers, volumes or student data.
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/service-common.sh"
check_arguments "$@"
check_docker
compose config --quiet
stop_services
