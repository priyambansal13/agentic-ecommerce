---
name: k8s-deploy
description: "Use when deploying, rolling back or debugging agentic-commerce on the k3s cluster (Oracle Cloud Always Free VM, or the local k3s-in-Docker env) — first install, deploying one service/zone with a new image tag, rolling back, adding a new service or zone to the cluster, creating/rotating Kubernetes Secrets, changing NetworkPolicies or resources, provisioning the VM with OCI Terraform, and debugging pods (Pending, CrashLoopBackOff, ImagePullBackOff, 502/504, TLS). Trigger on \"deploy\", \"release to prod\", \"roll back\", \"k8s\", \"k3s\", \"helm\", \"pod is failing\", \"Oracle VM\"."
---

# Deploy to k3s (Oracle Cloud) — and debug it

Design: `docs/01-hld.md` §1.8, ADR `docs/adr/0011-k3s-on-oracle-cloud.md`, step list `docs/06-dev-setup.md` §6.9,
chart details `deploy/README.md`. **Never** run `ac tf oci apply`, `ac k8s deploy prod`, `ac k8s rollback prod`,
`ac k8s secrets prod` or anything destructive without the user's explicit go-ahead for that action.

## 0. Know the layout
| Thing | Where / name |
|---|---|
| VM + k3s | `deploy/terraform/oci` (`ac tf oci init|plan|apply`), cloud-init installs k3s, cert-manager, opens iptables |
| Traefik timeouts (300 s for AG-UI) | `deploy/k3s/traefik-config.yaml` (HelmChartConfig) |
| Charts | `deploy/helm/agentic-infra` → ns `ac-infra` · `deploy/helm/agentic-commerce` → ns `ac-apps` |
| Service/zone list | `deploy/helm/agentic-commerce/values.services.yaml` — **generated** by `ac k8s values` from `backend/services/*/package.json` and `frontend/zones.json`; never hand-edit |
| Per-env settings | `deploy/envs/<env>.json` (`publicUrl`, `host`, `imageRegistry`, `defaultTag`, `tls`, `imagePullSecret`, `infra`/`apps` overrides) — committed |
| Release manifest | `deploy/envs/<env>.tags.json` — image tag per service/zone + history — committed |
| Secrets source | `deploy/envs/<env>.env` — gitignored, generated on first `ac k8s secrets <env>` |
| Kubeconfig | `deploy/envs/<env>.kubeconfig` — gitignored, `ac k8s kubeconfig <env>` |
| k8s objects | services: Deployment/Service `<service>`, Secret `svc-<service>` · zones: `zone-<zone>`, Secret `zone-<zone>` · `edge` (Kong, ConfigMap `edge-config` from `ac kong --k8s`) · `opa` · Job `db-bootstrap` · Secrets `ac-infra`, `ac-db-bootstrap`, optional `ghcr` |
| Images | `ghcr.io/<owner>/ac/<service>`, `ghcr.io/<owner>/ac/zone-<zone>` — **linux/arm64** |

## 1. Test locally first (always)
```bash
ac k8s local up                       # k3s in Docker: container ac-k3s, ingress http://localhost:8088, API :6445
ac docker build <name>                # for each changed service/zone (native arm64 on Apple Silicon)
ac k8s local load <name…>             # import images into the local cluster
ac k8s secrets local && ac k8s deploy local
ac k8s status local                   # all pods Ready? then curl http://localhost:8088/api/<service>/health
ac k8s local down                     # when done
```

## 2. First production install (with the user)
1. `deploy/terraform/oci/terraform.tfvars` (OCIDs, region, `ssh_public_key_path`, `admin_cidr`, `domain`,
   `acme_email`) → `ac tf oci init` → `ac tf oci plan` (show the user) → `ac tf oci apply` (user approves).
   "Out of host capacity" = A1 capacity exhausted → retry later / other `availability_domain_index`.
2. DNS A record → `public_ip` output. Wait for `cloud-init status --wait` on the VM (~5 min).
3. Fill `deploy/envs/prod.json`; `ac k8s kubeconfig prod`; `ac k8s secrets prod` (then add
   `OPENAI_API_KEY`, Stripe keys to `deploy/envs/prod.env` and re-run).
4. Build + push every image for arm64 (`ac docker build <name> --platform linux/arm64`,
   `ac docker push <name> --tag <tag>`; CI does this normally) and set tags in `prod.tags.json`.
5. `ac k8s deploy prod` → `ac k8s status prod` → `https://<domain>/`, `/api/<service>/health`, `/auth`.

## 3. Deploy / roll back ONE service or zone
```bash
ac k8s deploy prod catalog --tag 1.4.0     # updates prod.tags.json → helm upgrade; only catalog rolls
ac k8s status prod                          # wait for Ready; smoke /api/catalog/health
ac k8s rollback prod catalog                # previous tag from the manifest history → helm upgrade
```
Commit the changed `prod.tags.json` (it is the source of truth for what runs). Database migrations must be
expand/contract so old and new pods can run together during the roll.

## 4. Add a new service or zone to the cluster
1. Generate it in its repo (`ac new service …` / `ac new zone …`), build its image.
2. `ac k8s values` (regenerates `values.services.yaml`) and `ac kong --k8s` (new `/api/<service>` route in `edge-config`).
3. New service with a DB: `ac k8s secrets <env>` creates `svc-<name>` and adds its role/DB to `ac-db-bootstrap`;
   the `db-bootstrap` hook creates `ac_<db>`/`svc_<db>` on the next deploy.
4. Add its tag to `<env>.tags.json`; deploy to `local`, then `prod` with approval.
5. NetworkPolicies are generated per kind (service ← edge only; zone ← shell only). A new zone also needs a
   shell rebuild (rewrites are build-time: `ZONE_<NAME>_URL=http://zone-<name>:<port>`).

## 5. Secrets
- Only via `ac k8s secrets <env>` from `deploy/envs/<env>.env`; never `kubectl create secret` by hand, never in
  values files, git or images. Each service gets **only** its own `DATABASE_URL` + the keys in its `ac.secrets`.
- Rotate: edit the env file → `ac k8s secrets <env>` → `kubectl -n ac-apps rollout restart deploy/<name>`.

## 6. Debug
| Symptom | Look at |
|---|---|
| `Pending` | `kubectl describe pod` → insufficient memory/CPU on the 12 GB node: lower requests in `<env>.json` `apps`/`infra`, or scale a non-critical Deployment to 0 |
| `ImagePullBackOff` | tag not pushed, not arm64, or missing `ghcr` pull secret (`imagePullSecret` + `ac k8s secrets`) |
| `CrashLoopBackOff` | `kubectl -n ac-apps logs deploy/<name> --previous`; usually `DATABASE_URL`/secret or Kafka/Keycloak not ready |
| 401 everywhere | issuer must be the public `https://<domain>/auth/realms/…`; JWKS fetched in-cluster via `OIDC_JWKS_REWRITE` |
| 502 from `/api/<service>` | pod not Ready, or route missing → `ac kong --k8s` + redeploy |
| Service → service call times out | intended: NetworkPolicy allows only `edge` → services; call through `KONG_URL` |
| AG-UI stream cut ~60 s | Traefik timeouts (`deploy/k3s/traefik-config.yaml`) |
| Cert `Pending` | DNS not pointing at the VM yet / port 80 closed; `kubectl describe certificate -A` |
| Site down entirely | single node: check VM in OCI console, `sudo systemctl status k3s`, disk space; restore from backups if needed |

## Checklist
- [ ] Tested on `ac k8s local` first (pods Ready, health checks through the ingress)
- [ ] `values.services.yaml` regenerated (`ac k8s values`), Kong routes (`ac kong --k8s`) current
- [ ] Images arm64, pushed; `<env>.tags.json` updated and committed
- [ ] Secrets only via `ac k8s secrets`; nothing secret in git/values/images
- [ ] User approved any prod deploy/rollback/apply; one unit at a time; status watched
- [ ] Docs (01 §1.8, 06 §6.9, ADRs) updated if the deployment model changed
