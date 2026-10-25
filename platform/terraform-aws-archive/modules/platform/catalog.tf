# ─────────────────────────────────────────────────────────────────────────────────────────────
# Service & zone catalog. Adding a microservice or micro-frontend zone = one entry here
# (or in the env's `services` / `zones` override). Ports match local dev and the backend/frontend
# repos, so Kong's cloud config (`ac kong --cloud`) and the shell's zone URLs line up.
# ─────────────────────────────────────────────────────────────────────────────────────────────

variable "services" {
  description = "Backend microservices: one ECS service, ECR repo, log group, task role and (optionally) database each"
  type = map(object({
    port       = number
    database   = optional(string) # logical db suffix → database ac_<database>, role svc_<database>
    cpu        = optional(number, 256)
    memory     = optional(number, 512)
    critical   = optional(bool, true)       # false = may scale to zero in dev (scale_to_zero_noncritical)
    produces   = optional(list(string), []) # Kafka topics it writes (outbox); all producers may also write dlq.events
    consumes   = optional(list(string), []) # Kafka topics it reads; consumer groups must be named <service>.*
    s3_read    = optional(list(string), []) # bucket keys from modules/storage
    s3_write   = optional(list(string), [])
    s3_put     = optional(list(string), []) # write-only (audit)
    opensearch = optional(string)           # "rw" | "read"
    ses        = optional(bool, false)
    secrets    = optional(list(string), []) # names of this service's own third-party secrets (ac/<env>/<service>/<NAME>)
    env        = optional(map(string), {})
  }))
  default = {
    user = {
      port = 4101, database = "users", produces = ["user.events"]
    }
    catalog = {
      port    = 4102, database = "catalog", produces = ["catalog.events"], consumes = ["admin.events"]
      s3_read = ["images"], s3_write = ["images"]
    }
    search = {
      port = 4103, consumes = ["catalog.events", "inventory.events"], opensearch = "rw", memory = 1024
    }
    inventory = {
      port = 4104, database = "inventory", produces = ["inventory.events"], consumes = ["order.events", "payment.events"]
    }
    order = {
      port = 4105, database = "orders", produces = ["order.events"], consumes = ["payment.events", "fraud.events", "returns.events"]
      cpu  = 512, memory = 1024
    }
    payment = {
      port    = 4106, database = "payments", produces = ["payment.events"], consumes = ["order.events", "returns.events"]
      secrets = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]
      s3_put  = ["audit"]
    }
    returns = {
      port    = 4107, database = "returns", produces = ["returns.events"], consumes = ["order.events", "payment.events"]
      s3_read = ["evidence"], s3_write = ["evidence"]
    }
    fraud = {
      port     = 4108, database = "fraud", produces = ["fraud.events"]
      consumes = ["user.events", "order.events", "payment.events", "returns.events"]
    }
    notification = {
      port     = 4109, database = "notify", critical = false, ses = true
      consumes = ["user.events", "catalog.events", "inventory.events", "order.events", "payment.events", "returns.events", "fraud.events", "admin.events", "agent.events"]
    }
    admin = {
      port    = 4110, database = "admin", produces = ["admin.events"], consumes = ["catalog.events", "fraud.events", "agent.events"]
      s3_read = ["images", "evidence"], critical = false
    }
    seller-analytics = {
      port     = 4111, database = "analytics", critical = false
      consumes = ["order.events", "payment.events", "inventory.events", "returns.events"]
      s3_put   = ["kafka-archive"]
    }
    agents = {
      port     = 4300, database = "agents", cpu = 1024, memory = 2048
      produces = ["agent.events"], consumes = ["returns.events", "fraud.events", "catalog.events", "admin.events"]
      s3_read  = ["evidence", "images"], s3_put = ["audit"], opensearch = "read"
      secrets  = ["OPENAI_API_KEY", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "KEYCLOAK_AGENTS_CLIENT_SECRET"]
      env      = { OPA_URL = "http://127.0.0.1:8181" } # OPA sidecar in the same task
    }
  }
}

variable "zones" {
  description = "Next.js Multi-Zones micro-frontends. Only the shell is on the ALB; the shell rewrites to the other zones via Service Connect."
  type = map(object({
    port      = number
    base_path = string # "" for the shell; zone basePath otherwise
    cpu       = optional(number, 256)
    memory    = optional(number, 512)
    critical  = optional(bool, true)
    secrets   = optional(list(string), ["AUTH_SECRET", "AUTH_KEYCLOAK_SECRET"])
    env       = optional(map(string), {})
  }))
  default = {
    shell      = { port = 3300, base_path = "" }
    storefront = { port = 3301, base_path = "/shop", cpu = 512, memory = 1024 }
    account    = { port = 3302, base_path = "/account" }
    seller     = { port = 3303, base_path = "/seller", critical = false }
    admin-web  = { port = 3304, base_path = "/admin", critical = false }
  }
}

variable "edge" {
  description = "Kong API gateway (image ac/edge = kong + kong.cloud.yml from `ac kong --cloud`)"
  type = object({
    port   = optional(number, 8000)
    cpu    = optional(number, 256)
    memory = optional(number, 512)
  })
  default = {}
}
