# ADR 0011 — Host on k3s on an Oracle Cloud Always Free VM (AWS archived)

- **Status:** Accepted (2026-10-23)
- **Supersedes:** the AWS design (ECS Fargate per service/zone, Aurora, MSK Serverless, ElastiCache,
  OpenSearch Service, CloudFront), now archived in `platform/terraform-aws-archive/`.
- **Related:** [01 §1.8](../01-hld.md#18-deployment--infrastructure--k3s-on-oracle-cloud),
  [06 §6.9](../06-dev-setup.md#69-deploy-to-oracle-cloud-k3s), [07](../07-microservices.md), [08](../08-microfrontends.md)

## Context

- AWS cannot be used for this project ("currently we cannot use aws").
- The architecture is microservices with full isolation (12 services, 5 micro-frontend zones, Kong, OPA,
  one database per service) and must stay independently deployable per service/zone.
- Budget is minimal; the team already runs swarm-ai on an Oracle Cloud *Always Free* Ampere A1 VM
  (2 OCPU / 12 GB). The tenancy's free allowance is 4 OCPU / 24 GB of A1 in total, so 2 OCPU / 12 GB remain.
- Expected load is small (≈ 100 RPS peak, 1k orders/day); the stack idles at ≈ 6–7 GB RAM.

## Decision

1. Provision **one `VM.Standard.A1.Flex` VM (2 OCPU / 12 GB, Ubuntu 24.04 aarch64, 100 GB boot volume)**
   with Terraform (`platform/deploy/terraform/oci`, provider `oracle/oci`): VCN, public subnet, internet
   gateway, route table, security list (22/80/443 public; 6443 from `admin_cidr` only). Cloud-init installs
   **k3s** (Traefik ingress, local-path storage, NetworkPolicy controller), opens the image's iptables,
   sets Traefik timeouts to 300 s (AG-UI streams), installs cert-manager + Let's Encrypt, adds swap.
2. Two **Helm charts** (`platform/deploy/helm`): `agentic-infra` (ns `ac-infra`: Postgres 18 + pgvector
   with one database per service, Redis, Redpanda, OpenSearch, Keycloak under `/auth`, MinIO, Grafana
   otel-lgtm, backup CronJob) and `agentic-commerce` (ns `ac-apps`: one Deployment + Service per service
   and per zone — zones as `zone-<name>` — plus `edge` (Kong DB-less, routes in ConfigMap `edge-config`
   from `ac kong --k8s`), `opa`, the
   `db-bootstrap` hook Job, the Ingress and NetworkPolicies).
3. **Isolation stays enforced:** per-service Secret `svc-<name>` (own `DATABASE_URL` + declared secrets),
   per-service database/role, NetworkPolicies (services reachable only from `edge`, zones only from the
   shell, `ac-infra` only from `ac-apps`), non-root pods with resource limits.
4. **Images** on GitHub Container Registry (`ghcr.io/<owner>/ac/<service>`, `…/ac/zone-<zone>`), built for
   **linux/arm64** on `ubuntu-24.04-arm` runners.
5. **Per-env settings** in `platform/deploy/envs/<env>.json`; **independent releases** through a committed
   release manifest `platform/deploy/envs/<env>.tags.json`:
   `ac k8s deploy prod <name> --tag <t>` changes one entry and runs `helm upgrade` (only that Deployment
   rolls); `ac k8s rollback prod <name>` restores the previous tag.
6. Langfuse (Cloud, optional) and SMTP are external; Mailpit and Verdaccio stay local-only.

## Consequences

- **+** ≈ €0 hosting; one cloud account already in use; everything reproducible from code
  (`ac tf oci apply` + `ac k8s deploy`); Kubernetes primitives keep per-service deploy/rollback, probes,
  limits and network isolation — the microservice architecture is preserved.
- **+** Portable: the same charts run on k3s in Docker on a laptop (`ac k8s local`), on multi-node k3s or
  on OKE later.
- **−** **Single node = no high availability.** A VM, disk or k3s failure takes the whole site down;
  maintenance means downtime. Mitigations: nightly per-database backups (+ off-box copy), a rebuild in
  < 1 h, health-checked pods restarted automatically. Path to HA: add k3s nodes, move Postgres to a
  replicated setup or OKE.
- **−** We operate stateful systems ourselves (Postgres, Redpanda, OpenSearch, Keycloak) instead of managed
  services: upgrades, backups and tuning are on us; OpenSearch runs with the security plugin off inside
  the cluster network (reachable only from `ac-apps`).
- **−** Always-Free caveats: A1 capacity can be unavailable ("Out of host capacity"), and Oracle may
  reclaim idle Always-Free instances — keep it in use or move the tenancy to Pay-As-You-Go.
- **−** 2 OCPU limit CPU-heavy work (builds happen in CI, not on the VM; OpenSearch heap kept small).
- `@ac/kafka` keeps its opt-in MSK IAM code path (unused).
