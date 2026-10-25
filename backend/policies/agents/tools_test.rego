package agents.tools_test

import rego.v1

import data.agents.tools

refund_input(amount, status, risk) := {
	"agent": {"id": "refund", "autonomy_level": 3},
	"tool": "executeRefund",
	"tool_tier": "MONEY",
	"args": {"amount_minor": amount},
	"case": {"status": status, "policy_outcome": "REFUND", "risk_score": risk, "auto_eligible": true},
	"order": {"currency": "INR", "refundable_minor": 500000},
	"approvals": [],
}

test_auto_refund_inside_envelope_allowed if {
	tools.allow with input as refund_input(129900, "AUTO_APPROVED", 0.12)
}

test_auto_refund_above_cap_denied if {
	not tools.allow with input as refund_input(250000, "AUTO_APPROVED", 0.12)
}

test_auto_refund_high_risk_denied if {
	not tools.allow with input as refund_input(129900, "AUTO_APPROVED", 0.5)
}

test_auto_refund_shadow_mode_denied if {
	inp := object.union(refund_input(129900, "AUTO_APPROVED", 0.1), {"agent": {"id": "refund", "autonomy_level": 1}})
	not tools.allow with input as inp
}

test_refund_above_refundable_denied if {
	inp := object.union(refund_input(129900, "AUTO_APPROVED", 0.1), {"order": {"currency": "INR", "refundable_minor": 1000}})
	not tools.allow with input as inp
}

test_killswitch_denies if {
	not tools.allow with input as refund_input(129900, "AUTO_APPROVED", 0.1) with data.agents.killswitch as {"refund": true}
}

test_human_approved_refund_allowed if {
	inp := object.union(refund_input(450000, "APPROVED", 0.6), {"approvals": [{"role": "support", "status": "APPROVED"}]})
	tools.allow with input as inp
}

test_high_value_needs_finance if {
	base := refund_input(3000000, "APPROVED", 0.2)
	order := {"currency": "INR", "refundable_minor": 5000000}
	support_only := object.union(base, {"order": order, "approvals": [{"role": "support", "status": "APPROVED"}]})
	both := object.union(base, {"order": order, "approvals": [
		{"role": "support", "status": "APPROVED"},
		{"role": "finance", "status": "APPROVED"},
	]})
	not tools.allow with input as support_only
	tools.allow with input as both
}

test_read_tool_must_be_allow_listed if {
	tools.allow with input as {"agent": {"id": "assistant"}, "tool": "searchProducts", "tool_tier": "READ"}
	not tools.allow with input as {"agent": {"id": "assistant"}, "tool": "getBuyerRefundHistory", "tool_tier": "READ"}
}

test_reversible_needs_confirmation_or_autonomy if {
	not tools.allow with input as {"agent": {"id": "assistant", "autonomy_level": 2}, "tool": "addToCart", "tool_tier": "WRITE_REVERSIBLE"}
	tools.allow with input as {"agent": {"id": "assistant", "autonomy_level": 2}, "tool": "addToCart", "tool_tier": "WRITE_REVERSIBLE", "user_confirmed": true}
}

test_irreversible_never_allowed if {
	not tools.allow with input as {"agent": {"id": "order-support", "autonomy_level": 4}, "tool": "cancelOrder", "tool_tier": "WRITE_IRREVERSIBLE", "user_confirmed": true}
}

# ---- P3 refund agent: envelope facts are server-derived; red-team style inputs must never move money

test_auto_refund_not_auto_eligible_denied if {
	inp := object.union(refund_input(129900, "AUTO_APPROVED", 0.1), {"case": {"status": "AUTO_APPROVED", "policy_outcome": "REFUND", "risk_score": 0.1, "auto_eligible": false}})
	not tools.allow with input as inp
}

test_auto_store_credit_not_auto_executed if {
	inp := object.union(refund_input(129900, "AUTO_APPROVED", 0.1), {"case": {"status": "AUTO_APPROVED", "policy_outcome": "STORE_CREDIT", "risk_score": 0.1, "auto_eligible": true}})
	not tools.allow with input as inp
}

test_money_denied_at_every_level_below_3 if {
	every lvl in [0, 1, 2] {
		inp := object.union(refund_input(10000, "AUTO_APPROVED", 0.05), {"agent": {"id": "refund", "autonomy_level": lvl}})
		not tools.allow with input as inp
	}
}

test_money_denied_for_pending_or_requested_case if {
	every st in ["REQUESTED", "PENDING_HUMAN", "PROPOSED", "REJECTED", "REFUNDED"] {
		not tools.allow with input as refund_input(10000, st, 0.05)
	}
}

test_money_zero_or_negative_amount_denied if {
	not tools.allow with input as refund_input(0, "AUTO_APPROVED", 0.05)
	not tools.allow with input as refund_input(-500, "AUTO_APPROVED", 0.05)
}

test_money_other_agent_denied if {
	inp := object.union(refund_input(10000, "AUTO_APPROVED", 0.05), {"agent": {"id": "assistant", "autonomy_level": 4}})
	not tools.allow with input as inp
}

test_money_unknown_currency_denied if {
	inp := object.union(refund_input(10000, "AUTO_APPROVED", 0.05), {"order": {"currency": "XYZ", "refundable_minor": 500000}})
	not tools.allow with input as inp
}

test_money_denial_reasons_explain if {
	r := tools.decision.reasons with input as refund_input(250000, "PENDING_HUMAN", 0.5)
	"amount above the auto-approve cap" in r
	"case is not AUTO_APPROVED" in r
	"risk too high for auto execution" in r
}

proposal(mode, lvl) := {"agent": {"id": "refund", "autonomy_level": lvl}, "tool": "submitProposal", "tool_tier": "WRITE_REVERSIBLE", "args": {"mode": mode}}

test_shadow_proposal_allowed_from_l1 if {
	tools.allow with input as proposal("SHADOW", 1)
	tools.allow with input as proposal("RECOMMEND", 2)
}

test_live_proposal_needs_l3 if {
	not tools.allow with input as proposal("LIVE", 1)
	not tools.allow with input as proposal("LIVE", 2)
	tools.allow with input as proposal("LIVE", 3)
}

test_ui_confirmation_never_makes_a_proposal_live if {
	not tools.allow with input as object.union(proposal("LIVE", 1), {"user_confirmed": true})
}

test_proposal_killed if {
	not tools.allow with input as proposal("SHADOW", 1) with data.agents.killswitch as {"refund": true}
}

test_evidence_request_needs_l3 if {
	req := {"agent": {"id": "refund", "autonomy_level": 1}, "tool": "requestBuyerEvidence", "tool_tier": "WRITE_REVERSIBLE", "args": {}}
	not tools.allow with input as req
	tools.allow with input as object.union(req, {"agent": {"id": "refund", "autonomy_level": 3}})
}

test_refund_read_tools_allowed if {
	every t in ["getCaseContext", "scoreRisk", "evaluatePolicy"] {
		tools.allow with input as {"agent": {"id": "refund", "autonomy_level": 1}, "tool": t, "tool_tier": "READ"}
	}
}
