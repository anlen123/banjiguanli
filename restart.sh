#!/usr/bin/env bash
# Rebuild/recreate so updated code and .env take effect; never delete volumes.
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/service-common.sh"
check_arguments "$@"
check_docker
prepare_environment
# Build before stopping: a build failure must not take a working service offline.
printf '正在预先构建镜像，构建成功后再重启服务……\n'
compose build
stop_services
start_services --no-build
