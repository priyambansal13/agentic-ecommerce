{{/* one line, comma-separated: usable inside flow maps → labels: { app: x, {{ include "infra.labels" . }} } */}}
{{- define "infra.labels" -}}
app.kubernetes.io/part-of: agentic-commerce, app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "infra.secret" -}}
valueFrom:
  secretKeyRef:
    name: ac-infra
    key: {{ . }}
{{- end -}}

{{- define "infra.podSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  capabilities: { drop: [ALL] }
{{- end -}}
