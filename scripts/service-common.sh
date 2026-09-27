#!/usr/bin/env bash
# Shared Docker Compose helpers; never source .env as shell code.
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

check_arguments() {
    if (( $# != 0 )); then
        printf '用法：%s（无需参数）\n' "$(basename -- "$0")" >&2
        exit 2
    fi
}

check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        printf '错误：请先安装 Docker Engine 和 Docker Compose v2。\n' >&2
        exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
        printf '错误：未找到 Docker Compose v2，请安装 docker compose 插件。\n' >&2
        exit 1
    fi
    if ! docker info >/dev/null 2>&1; then
        printf '错误：无法连接 Docker，请检查 Docker 服务及当前用户权限。\n' >&2
        exit 1
    fi
}

compose() {
    local env_file="$PROJECT_ROOT/.env.example"
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        env_file="$PROJECT_ROOT/.env"
    fi
    docker compose --project-directory "$PROJECT_ROOT" \
        --env-file "$env_file" -f "$PROJECT_ROOT/docker-compose.yml" "$@"
}

prepare_environment() {
    if [[ ! -e "$PROJECT_ROOT/.env" ]]; then
        # noclobber prevents overwriting a configuration created concurrently.
        (umask 077; set -o noclobber; cat "$PROJECT_ROOT/.env.example" > "$PROJECT_ROOT/.env")
        printf '已从 .env.example 创建 .env（权限 600）。\n'
        printf '默认仅本机访问 http://localhost:8080；对外使用前请配置域名及 HTTPS。\n'
    fi
    compose config --quiet
}

start_services() {
    local build_flag="${1:---build}"
    printf '正在启动班级小岛，首次启动需要下载依赖……\n'
    compose up --detach "$build_flag" --wait --wait-timeout 180
    compose ps
    printf '\n班级小岛已启动。访问地址以 .env 中的 APP_ORIGIN 为准。\n'
    printf '首次使用请创建管理员（没有默认账号）：\n'
    printf '  cd %q && docker compose exec backend python app.py create-admin --username admin --name 班长\n' "$PROJECT_ROOT"
}

stop_services() {
    printf '正在停止班级小岛……\n'
    compose stop --timeout 30
    printf '服务已停止，容器及数据库、附件等数据卷均保留。\n'
}
