#!/usr/bin/env bash
# Deploy FinAlly to Azure Container Instances.
#
# Used manually (after `az login`) AND by the Azure DevOps Deploy stage (with --image, inside AzureCLI@2).
#
# Usage:
#   deploy/azure/deploy-aci.sh                      # build locally, push to ACR, deploy
#   deploy/azure/deploy-aci.sh --image <acr>.azurecr.io/finally:123   # deploy an already-pushed image
#   deploy/azure/deploy-aci.sh --bootstrap          # also create RG + ACR (+ storage/share if AZURE_FILES=true)
#
# Configuration (env vars; defaults in brackets):
#   AZ_RESOURCE_GROUP   [finally-rg]        AZ_LOCATION        [eastus]
#   ACR_NAME            (required, globally unique, alphanumeric)
#   IMAGE_REPOSITORY    [finally]           IMAGE_TAG          [git short sha or 'latest']
#   ACI_NAME            [finally-aci]       ACI_DNS_LABEL      [finally-<random>; must be unique per region]
#   ACI_CPU             [1]                 ACI_MEMORY_GB      [1.5]
#   OPENROUTER_API_KEY  (secret; passed as a secure env var)  MASSIVE_API_KEY (optional secret)
#   LLM_MOCK            [false]
#   AZURE_FILES         [false]  true => mount an Azure Files share at /app/db for persistence
#   STORAGE_ACCOUNT     (required if AZURE_FILES=true)       FILE_SHARE [finally-db]
set -euo pipefail

BOOTSTRAP=0
IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap) BOOTSTRAP=1; shift ;;
    --image) IMAGE="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RG="${AZ_RESOURCE_GROUP:-finally-rg}"
LOCATION="${AZ_LOCATION:-eastus}"
ACR_NAME="${ACR_NAME:?ACR_NAME is required}"
REPO="${IMAGE_REPOSITORY:-finally}"
TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo latest)}"
ACI_NAME="${ACI_NAME:-finally-aci}"
DNS_LABEL="${ACI_DNS_LABEL:-finally-$(echo "$RG$ACR_NAME" | cksum | cut -d' ' -f1)}"
CPU="${ACI_CPU:-1}"
MEM="${ACI_MEMORY_GB:-1.5}"
LLM_MOCK="${LLM_MOCK:-false}"
AZURE_FILES="${AZURE_FILES:-false}"
FILE_SHARE="${FILE_SHARE:-finally-db}"

az account show >/dev/null || { echo "Not logged in to Azure (run: az login)" >&2; exit 1; }

if [[ "$BOOTSTRAP" -eq 1 ]]; then
  echo "==> Bootstrapping resource group / ACR"
  az group create -n "$RG" -l "$LOCATION" -o none
  az acr show -n "$ACR_NAME" -g "$RG" -o none 2>/dev/null \
    || az acr create -n "$ACR_NAME" -g "$RG" --sku Basic --admin-enabled true -o none
  if [[ "$AZURE_FILES" == "true" ]]; then
    : "${STORAGE_ACCOUNT:?STORAGE_ACCOUNT is required when AZURE_FILES=true}"
    az storage account show -n "$STORAGE_ACCOUNT" -g "$RG" -o none 2>/dev/null \
      || az storage account create -n "$STORAGE_ACCOUNT" -g "$RG" -l "$LOCATION" --sku Standard_LRS -o none
    az storage share-rm create --storage-account "$STORAGE_ACCOUNT" -g "$RG" -n "$FILE_SHARE" --quota 1 -o none
  fi
fi

LOGIN_SERVER="$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)"

if [[ -z "$IMAGE" ]]; then
  IMAGE="$LOGIN_SERVER/$REPO:$TAG"
  echo "==> Building and pushing $IMAGE"
  az acr login -n "$ACR_NAME"
  docker build -t "$IMAGE" "$ROOT_DIR"
  docker push "$IMAGE"
fi

echo "==> Fetching registry credentials"
# Requires the ACR admin user (az acr update -n $ACR_NAME --admin-enabled true).
# Alternative: a pull-only service principal — set ACR_PULL_USERNAME / ACR_PULL_PASSWORD instead.
REG_USER="${ACR_PULL_USERNAME:-$(az acr credential show -n "$ACR_NAME" --query username -o tsv)}"
REG_PASS="${ACR_PULL_PASSWORD:-$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv)}"

# Azure DevOps passes an undefined variable through as the literal "$(NAME)" — treat that as unset.
for v in OPENROUTER_API_KEY MASSIVE_API_KEY; do
  if [[ "${!v:-}" == '$('* ]]; then unset "$v"; fi
done

ENV_VARS=("LLM_MOCK=$LLM_MOCK" "FINALLY_DB_PATH=/app/db/finally.db" "STATIC_DIR=/app/static")
SECURE_ENV=()
[[ -n "${OPENROUTER_API_KEY:-}" ]] && SECURE_ENV+=("OPENROUTER_API_KEY=$OPENROUTER_API_KEY")
[[ -n "${MASSIVE_API_KEY:-}" ]] && SECURE_ENV+=("MASSIVE_API_KEY=$MASSIVE_API_KEY")
[[ -z "${OPENROUTER_API_KEY:-}" ]] && echo "WARNING: OPENROUTER_API_KEY not set — AI chat will not work (unless LLM_MOCK=true)."

VOLUME_ARGS=()
if [[ "$AZURE_FILES" == "true" ]]; then
  : "${STORAGE_ACCOUNT:?STORAGE_ACCOUNT is required when AZURE_FILES=true}"
  STORAGE_KEY="$(az storage account keys list -n "$STORAGE_ACCOUNT" -g "$RG" --query '[0].value' -o tsv)"
  VOLUME_ARGS=(--azure-file-volume-account-name "$STORAGE_ACCOUNT"
               --azure-file-volume-account-key "$STORAGE_KEY"
               --azure-file-volume-share-name "$FILE_SHARE"
               --azure-file-volume-mount-path /app/db)
fi

SECURE_ARGS=()
[[ ${#SECURE_ENV[@]} -gt 0 ]] && SECURE_ARGS=(--secure-environment-variables "${SECURE_ENV[@]}")

echo "==> Deploying $IMAGE to ACI '$ACI_NAME' (dns: $DNS_LABEL)"
# Delete first: several container-group properties (image creds, volumes, env) cannot be updated in place.
az container delete -g "$RG" -n "$ACI_NAME" --yes -o none 2>/dev/null || true
az container create \
  -g "$RG" -n "$ACI_NAME" -l "$LOCATION" \
  --image "$IMAGE" \
  --os-type Linux \
  --cpu "$CPU" --memory "$MEM" \
  --registry-login-server "$LOGIN_SERVER" \
  --registry-username "$REG_USER" \
  --registry-password "$REG_PASS" \
  --ip-address Public \
  --dns-name-label "$DNS_LABEL" \
  --ports 8000 \
  --restart-policy Always \
  --environment-variables "${ENV_VARS[@]}" \
  ${SECURE_ARGS[@]+"${SECURE_ARGS[@]}"} \
  ${VOLUME_ARGS[@]+"${VOLUME_ARGS[@]}"} \
  -o none

FQDN="$(az container show -g "$RG" -n "$ACI_NAME" --query ipAddress.fqdn -o tsv)"
URL="http://$FQDN:8000"
echo "==> Smoke testing $URL/api/health"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$URL/api/health"; then
    echo
    echo "Deployed: $URL"
    # Expose to Azure DevOps if running there.
    [[ -n "${TF_BUILD:-}" ]] && echo "##vso[task.setvariable variable=appUrl;isOutput=true]$URL"
    exit 0
  fi
  echo "  attempt $i: not ready yet"; sleep 10
done
echo "Smoke test failed for $URL" >&2
az container logs -g "$RG" -n "$ACI_NAME" || true
exit 1
