# Authorization for agent tool calls. Queried by apps/agents (governance/opa.client.ts):
#   POST /v1/data/agents/tools/decision  { "input": { agent, tool, tool_tier, args, case, order, approvals } }
# Data: policies/agents/data.json (limits, tool allow-lists); killswitch can be overridden at runtime via
#   PUT /v1/data/agents/killswitch  { "refund": true }
package agents.tools

import rego.v1

default allow := false

agent_may_use_tool if input.tool in data.agents.agent_tools[input.agent.id]

killed if data.agents.killswitch[input.agent.id] == true

# READ tools: allow-listed per agent. Services still enforce row-level ownership.
allow if {
	input.tool_tier == "READ"
	agent_may_use_tool
	not killed
}

# WRITE_REVERSIBLE: allow-listed and either user-confirmed in the UI or agent autonomy >= L3.
# (submitProposal has its own rule below — a UI confirmation never makes a proposal LIVE.)
allow if {
	input.tool_tier == "WRITE_REVERSIBLE"
	input.tool != "submitProposal"
	agent_may_use_tool
	not killed
	reversible_ok
}

reversible_ok if input.user_confirmed == true

reversible_ok if input.agent.autonomy_level >= 3

# submitProposal only stores a proposal: SHADOW (L1) / RECOMMEND (L2) from L1 upward; LIVE (may auto-approve) needs L3.
allow if {
	input.tool == "submitProposal"
	agent_may_use_tool
	not killed
	proposal_mode_ok
}

proposal_mode_ok if {
	input.args.mode in {"SHADOW", "RECOMMEND"}
	input.agent.autonomy_level >= 1
}

proposal_mode_ok if {
	input.args.mode == "LIVE"
	input.agent.autonomy_level >= 3
}

# MONEY: refund agent auto-execution inside the policy envelope (docs/03 §3.3). Every fact under input.case / input.order
# is loaded server-side by the agents service (fresh case, fresh risk, fresh policy result) — never from model output.
allow if {
	input.tool_tier == "MONEY"
	input.agent.id == "refund"
	agent_may_use_tool
	not killed
	in_auto_envelope
}

in_auto_envelope if {
	input.agent.autonomy_level >= 3
	input.case.status == "AUTO_APPROVED"
	input.case.auto_eligible == true
	input.case.policy_outcome in {"REFUND", "PARTIAL_REFUND"}
	input.case.risk_score < data.agents.limits.refund.max_risk
	input.args.amount_minor > 0
	input.args.amount_minor <= data.agents.limits.refund.auto_max_minor[input.order.currency]
	input.args.amount_minor <= input.order.refundable_minor
}

# MONEY: any amount once the required human approvals are recorded (dual control above threshold).
allow if {
	input.tool_tier == "MONEY"
	agent_may_use_tool
	not killed
	input.case.status == "APPROVED"
	input.args.amount_minor > 0
	input.args.amount_minor <= input.order.refundable_minor
	has_approval("support")
	dual_control_ok
}

has_approval(role) if {
	some a in input.approvals
	a.role == role
	a.status == "APPROVED"
}

dual_control_ok if input.args.amount_minor <= data.agents.limits.refund.dual_control_minor[input.order.currency]

dual_control_ok if has_approval("finance")

# WRITE_IRREVERSIBLE is never allowed for agents (humans only).

reasons contains "agent killed by admin" if killed

reasons contains "tool not allow-listed for agent" if not agent_may_use_tool

reasons contains "amount exceeds refundable amount" if input.args.amount_minor > input.order.refundable_minor

reasons contains "irreversible tools are human-only" if input.tool_tier == "WRITE_IRREVERSIBLE"


money_problems contains "autonomy below L3 (shadow/recommend never move money)" if input.agent.autonomy_level < 3

money_problems contains "case is not AUTO_APPROVED" if input.case.status != "AUTO_APPROVED"

money_problems contains "case outside the auto-approve envelope" if input.case.auto_eligible != true

money_problems contains "outcome not allowed for auto execution" if not input.case.policy_outcome in {"REFUND", "PARTIAL_REFUND"}

money_problems contains "risk too high for auto execution" if input.case.risk_score >= data.agents.limits.refund.max_risk

money_problems contains "amount above the auto-approve cap" if input.args.amount_minor > data.agents.limits.refund.auto_max_minor[input.order.currency]

money_problems contains "amount must be positive" if input.args.amount_minor <= 0

reasons contains msg if {
	input.tool_tier == "MONEY"
	not allow
	some msg in money_problems
}

reasons contains "proposal mode not allowed at this autonomy level" if {
	input.tool == "submitProposal"
	not proposal_mode_ok
}

reasons contains "reversible action needs user confirmation or L3" if {
	input.tool_tier == "WRITE_REVERSIBLE"
	input.tool != "submitProposal"
	not reversible_ok
}

decision := {"allow": allow, "reasons": reasons}
