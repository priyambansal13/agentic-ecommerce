{{- define "ac.labels" -}}
app.kubernetes.io/part-of: agentic-commerce, app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* image for a service/zone: <registry>/<image>:<tag> ; args: dict "root" $ "app" $app */}}
{{- define "ac.image" -}}
{{ .root.Values.global.imageRegistry }}/{{ .app.image }}:{{ .app.tag | default .root.Values.global.defaultTag }}
{{- end -}}

{{- define "ac.containerSecurity" -}}
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities: { drop: [ALL] }
{{- end -}}

{{- define "ac.issuers" -}}
{{ .Values.global.publicUrl }}/auth/realms/customers,{{ .Values.global.publicUrl }}/auth/realms/staff
{{- end -}}
