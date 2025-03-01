#!/bin/bash
set -e

VERSION=$1

if [[ -z "$VERSION" ]]; then
    echo "New version string required"
    exit 1
fi

npm version --workspaces "$VERSION"

# Update the obsidian-launcher dependency without modifying anything else
SERVICE_PACKAGE_JSON=$(cat packages/wdio-obsidian-service/package.json)
echo "$SERVICE_PACKAGE_JSON" | jq \
    --arg v "$VERSION" \
    --indent 4 \
    '.dependencies["obsidian-launcher"]=("^" + $v)' \
    > packages/wdio-obsidian-service/package.json

PACKAGE_LOCK_JSON=$(cat package-lock.json)
echo "$PACKAGE_LOCK_JSON" | jq \
    --arg v "$VERSION" \
    --indent 4 \
    '.packages["packages/wdio-obsidian-service"].dependencies["obsidian-launcher"]=("^" + $v)' \
    > package-lock.json

npm ci

git add package-lock.json packages/*/package.json
git commit -m "Bump version to $VERSION"
