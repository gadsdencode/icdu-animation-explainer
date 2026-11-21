export type Scenario = "compliant" | "ungoverned";
export type Mode = "with" | "without";
export type NodeId = "input" | "define" | "gate" | "execute" | "audit";

export const NODES: { id: NodeId; label: string; kicker: string; blurb: string }[] = [
  { id: "input", label: "Input", kicker: "01", blurb: "Raw work request" },
  { id: "define", label: "DEFINE", kicker: "02", blurb: "Intent Contract" },
  { id: "gate", label: "GATE", kicker: "03", blurb: "Policy checkpoint" },
  { id: "execute", label: "EXECUTE", kicker: "04", blurb: "Bounded model call" },
  { id: "audit", label: "AUDIT", kicker: "05", blurb: "Reviewable evidence" },
];

export const RAW_REQUEST =
  "Draft a clinical summary and coverage recommendation for Patient #4092";

export function sequence(mode: Mode, scenario: Scenario): NodeId[] {
  if (mode === "without") return ["input", "execute"];
  if (scenario === "ungoverned") return ["input", "define", "gate", "audit"];
  return ["input", "define", "gate", "execute", "audit"];
}

/** Illustrative FNV-1a style digest. Not a cryptographic hash. */
export function illustrativeHash(s: string): string {
  let out = "";
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return "sha256-sim:" + out;
}

export const CONTRACT = {
  compliant: {
    goal: "Summarize encounter history and draft coverage recommendation for reviewer sign-off",
    context: "Role: Utilization Review Nurse (RN-UR-2). Expertise: payer policy MCG 27th ed. Source: EHR encounters 2024-01..2024-11",
    success: "Cites policy clause per recommendation; no PHI beyond minimum necessary; human reviewer must approve",
  },
  ungoverned: {
    goal: "Draft clinical summary and coverage recommendation",
    context: "Requester role: unknown. Data scope: unspecified. Purpose of use: not declared",
    success: "Not defined",
  },
};

export type Check = { group: string; name: string; pass: boolean; detail: string };

export function gateChecks(s: Scenario): Check[] {
  const ok = s === "compliant";
  return [
    { group: "Policy Boundaries", name: "Purpose of use declared", pass: ok, detail: ok ? "TPO / utilization review" : "Missing: purpose of use not stated" },
    { group: "Policy Boundaries", name: "Output requires human sign-off", pass: true, detail: "Recommendation flagged as draft" },
    { group: "Data Permissions", name: "Requester authorized for Patient #4092", pass: ok, detail: ok ? "RN-UR-2 assigned to case UR-77813" : "Blocked: no role or case assignment" },
    { group: "Data Permissions", name: "Minimum-necessary data scope", pass: ok, detail: ok ? "Encounters + active Rx only" : "Unbounded record access requested" },
    { group: "Compliance Rules", name: "HIPAA minimum necessary (sim.)", pass: ok, detail: ok ? "Scope matches declared purpose" : "Cannot evaluate without purpose" },
    { group: "Compliance Rules", name: "Success criteria present", pass: ok, detail: ok ? "3 criteria, measurable" : "Missing: no success criteria" },
  ];
}

export const POLICY_VERSION = "pol-2025.03.2-sim";

export function auditRecord(s: Scenario) {
  const ok = s === "compliant";
  const contract = CONTRACT[s];
  return {
    _notice: "SIMULATION - illustrative record, not a production immutable log",
    record_id: ok ? "aud_7f3c-4092-a1" : "aud_7f3c-4092-b9",
    intent_hash: illustrativeHash(JSON.stringify(contract)),
    gate_decision: ok ? "APPROVED" : "BLOCKED",
    blocked_reasons: ok ? [] : gateChecks(s).filter((c) => !c.pass).map((c) => c.detail),
    policy_version: POLICY_VERSION,
    provider: ok ? "provider-routed (bounded)" : "none - execution never started",
    model_output_stored: ok,
    human_review_ready: ok,
    next_action: ok ? "Route to reviewer queue UR-77813" : "Return to requester: add role, purpose and scope",
    timestamp: "2025-03-14T09:42:17.204Z",
  };
}

export function contractJson(s: Scenario) {
  const c = CONTRACT[s];
  return {
    _notice: "SIMULATION - sample data",
    intent_contract: {
      goal: c.goal,
      context_and_expertise: c.context,
      success_criteria: c.success,
      subject: "Patient #4092 (synthetic)",
      sensitivity: "PHI",
    },
    intent_hash: illustrativeHash(JSON.stringify(c)),
  };
}

export function boundedPayload(provider: "A" | "B") {
  return {
    _notice: "SIMULATION - no real model was called",
    route: provider === "A" ? "provider-a/clinical-large" : "provider-b/reasoning-md",
    system_bounds: ["cite_policy_clause", "no_final_determination", "phi_minimum_necessary", "max_tokens:900"],
    response: {
      clinical_summary:
        "62F, T2DM with stage 3a CKD. 4 encounters in 11 mo; HbA1c 8.9 -> 7.6 on current regimen. Referred for CGM evaluation.",
      coverage_recommendation: "DRAFT: Meets criteria for CGM coverage (MCG A-0617, clause 2b). Requires reviewer sign-off.",
      confidence: provider === "A" ? 0.83 : 0.79,
    },
  };
}

export const UNGUARDED_OUTPUT = {
  _notice: "SIMULATION - illustrates an ungoverned direct call",
  route: "any-model/direct",
  prompt: RAW_REQUEST,
  response:
    "Patient #4092 has diabetes and kidney issues. Coverage is APPROVED for CGM and related supplies.",
  issues: ["No requester authorization checked", "Final determination stated by model", "No policy citation", "No evidence record created"],
};
