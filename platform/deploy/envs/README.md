# Deployment environments

| File | Committed | Purpose |
|---|---|---|
| `<env>.json` | yes | Non-secret settings: public URL, ingress host, image registry, TLS issuer, chart overrides (`infra` → agentic-infra, `apps` → agentic-commerce) |
| `<env>.tags.json` | yes | **Release manifest**: image tag per service/zone + history. `ac k8s deploy <env> <name> --tag X` changes one entry; `ac k8s rollback <env> <name>` restores the previous one |
| `<env>.env` | **no** (gitignored) | Secrets, generated with random values on first use (`ac k8s secrets <env>`); add API keys by hand |
| `<env>.kubeconfig` | **no** | Cluster credentials (`ac k8s kubeconfig <env>`, or written by `ac k8s local up`) |
