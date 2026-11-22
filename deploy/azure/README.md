# Deploying FinAlly to Azure (ACR + Azure Container Instances)

The Azure DevOps pipeline (`azure-pipelines.yml`) runs:

| Stage | Runs on | What it does |
|---|---|---|
| UnitTests | every PR and push to `main` | backend `ruff` + `pytest` (JUnit + Cobertura coverage), frontend `npm run lint` + `npm test` (JUnit) |
| Build | every PR and push to `main` | `docker build -t finally:$(Build.BuildId)`, saved as the `docker-image` pipeline artifact |
| E2E | every PR and push to `main` | runs the built image with `LLM_MOCK=true` and runs Playwright (`test/`) in the official Playwright image via `scripts/ci/run_e2e.sh`; publishes JUnit, the HTML report and the app log, and fails if any test fails |
| Push | `main` only | pushes `<acr>.azurecr.io/finally:$(Build.BuildId)` and `:latest` through the ACR service connection |
| Deploy | `main` only | `AzureCLI@2` runs `deploy/azure/deploy-aci.sh --image ...`, which recreates the ACI container group and smoke-tests `/api/health` |

All names are pipeline variables at the top of `azure-pipelines.yml`. Secrets come only from the variable group `finally-secrets`.

## One-time setup

The examples use the default variable values. If you change a name here, change the matching variable in `azure-pipelines.yml`.

```bash
az login
RG=finally-rg; LOC=eastus; ACR=finallyacr          # ACR names must be globally unique, alphanumeric only

# 1. Resource group + container registry (admin user enabled so ACI can pull)
az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true

# 2. (Optional) Azure Files share for persistent SQLite at /app/db
SA=finallystorage                                     # globally unique, lowercase
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS
az storage share-rm create --storage-account $SA -g $RG -n finally-db --quota 1
```

You can also run `ACR_NAME=$ACR deploy/azure/deploy-aci.sh --bootstrap` (add `AZURE_FILES=true STORAGE_ACCOUNT=$SA` to include storage). It creates these resources and then deploys.

### Azure DevOps

1. **Service connection `finally-azure`** (Project settings → Service connections → Azure Resource Manager, workload identity federation recommended). Scope it to resource group `finally-rg`. The pipeline needs Contributor on the RG to create container groups, read ACR credentials and list storage keys.
2. **Service connection `finally-acr`** (Docker Registry → Azure Container Registry → pick `finallyacr`).
3. **Variable group `finally-secrets`** (Pipelines → Library):
   - `OPENROUTER_API_KEY`: mark as secret (required for real AI chat)
   - `MASSIVE_API_KEY`: optional, mark as secret (leave it out to use the simulator)

   Allow the pipeline to use the group. It is linked only to the Deploy stage, so PR builds never see it.
4. **Environment `finally-production`** (Pipelines → Environments). Add approvals or checks there if you want a manual gate before deploying.
5. Create the pipeline from `azure-pipelines.yml`. On the first run, authorize the service connections, the variable group and the environment.

The variables you are most likely to change are `acrName`, `resourceGroup`, `location`, `aciName`, `aciDnsLabel` (must be unique per region), `useAzureFiles`, `storageAccount` and `fileShare`.

## Manual deployment (no pipeline)

```bash
az login
export ACR_NAME=finallyacr AZ_RESOURCE_GROUP=finally-rg
export OPENROUTER_API_KEY=sk-or-...            # never commit this
deploy/azure/deploy-aci.sh                     # build locally, push, deploy, smoke test
# or deploy an image that is already in ACR:
deploy/azure/deploy-aci.sh --image finallyacr.azurecr.io/finally:123
```

The app is served at `http://<dns-label>.<region>.azurecontainer.io:8000`.

## Persistence and caveats

- **Without Azure Files (default):** the SQLite DB lives in the container. It is reset on every deploy or restart, which is fine for a demo.
- **With Azure Files (`useAzureFiles: 'true'`):** the share is mounted at `/app/db` and `FINALLY_DB_PATH=/app/db/finally.db`. Azure Files is SMB, and SQLite WAL mode needs shared-memory locking that SMB does not provide reliably. With one container instance this usually works, but if you see `database is locked` or `disk I/O error`, the backend needs a non-WAL journal mode on network storage (see the Database Engineer's `app.db`). Run only one instance.
- ACI pulls with the ACR admin credentials, which the script fetches at deploy time. To use a pull-only service principal instead, set `ACR_PULL_USERNAME` and `ACR_PULL_PASSWORD` (from the variable group) and disable the admin user.
- ACI gives you plain HTTP on port 8000. For TLS or a custom domain, put Azure Front Door or Application Gateway in front, or move to Azure Container Apps.
- SSE (`/api/stream/prices`) works directly against ACI because there is no buffering proxy in between.
