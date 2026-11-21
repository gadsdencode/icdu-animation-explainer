import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, RotateCcw, Copy, Download, Check as CheckIcon,
  ShieldCheck, ShieldAlert, FileText, Braces, Cpu, ScrollText, X, AlertTriangle, ArrowRight,
} from "lucide-react";
import {
  NODES, RAW_REQUEST, sequence, gateChecks, auditRecord, contractJson, boundedPayload,
  UNGUARDED_OUTPUT, CONTRACT, POLICY_VERSION, illustrativeHash,
  type Mode, type Scenario, type NodeId,
} from "@/lib/icdu";

const C = { cyan: "#38BDF8", emerald: "#10B981", amber: "#F59E0B", crimson: "#EF4444", slate: "#334155" };
const SPRING = { type: "spring" as const, stiffness: 260, damping: 24 };
const STEP_MS = 2800;

type Status = "idle" | "active" | "done" | "blocked" | "skipped" | "absent";

/* geometry in viewBox units */
const VB_W = 1300, VB_H = 470, CY = 215, NW = 180;
const CX: Record<NodeId, number> = { input: 120, define: 385, gate: 650, execute: 915, audit: 1180 };
const link = (a: NodeId, b: NodeId) => {
  const x1 = CX[a] + NW / 2, x2 = CX[b] - NW / 2;
  return `M${x1},${CY} C${x1 + 45},${CY - 46} ${x2 - 45},${CY + 46} ${x2},${CY}`;
};
const EDGES = [
  { id: "e1", from: "input" as NodeId, to: "define" as NodeId, d: link("input", "define") },
  { id: "e2", from: "define" as NodeId, to: "gate" as NodeId, d: link("define", "gate") },
  { id: "e3", from: "gate" as NodeId, to: "execute" as NodeId, d: link("gate", "execute") },
  { id: "e4", from: "execute" as NodeId, to: "audit" as NodeId, d: link("execute", "audit") },
];
const BYPASS_D = `M${CX.gate},${CY + 118} C${CX.gate},${VB_H - 8} ${CX.audit},${VB_H - 8} ${CX.audit},${CY + 118}`;
const DIRECT_D = `M${CX.input},${CY - 112} C${CX.input + 60},10 ${CX.execute - 60},10 ${CX.execute},${CY - 112}`;

function narration(mode: Mode, scenario: Scenario, node: NodeId): string {
  if (mode === "without") {
    return node === "input"
      ? "A raw request goes straight to a model. No contract, no checks, no record of why."
      : "The model answers anyway. It states a coverage determination, and nothing proves who asked or what policy applied.";
  }
  const ok = scenario === "compliant";
  switch (node) {
    case "input": return "A clinician-facing team submits a raw work request. On its own it carries no role, purpose, or scope.";
    case "define": return ok ? "DEFINE converts the request into an Intent Contract: goal, context and expertise, success criteria." : "DEFINE tries to build a contract, but the request arrives with no role, purpose of use, or success criteria.";
    case "gate": return ok ? "GATE checks policy boundaries, data permissions and compliance rules. Every check passes." : "GATE stops the request before any model is called. Missing authorization and context are named, not guessed.";
    case "execute": return "EXECUTE sends a bounded payload to any approved provider. Swap A or B; the contract and limits stay identical.";
    case "audit": return ok ? "AUDIT seals reviewable evidence: intent hash, gate decision, policy version, ready for human review." : "The blocked attempt still bypasses to AUDIT. The record shows BLOCKED, with reasons, and no model output exists.";
  }
}

/* ---------- JSON pretty printer ---------- */
function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts = text.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|-?\d+\.?\d*)/g);
  return (
    <pre className="mono text-[12px] leading-[1.65] whitespace-pre-wrap break-words text-slate-400" data-testid="text-payload-json">
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^".*"\s*:$/.test(p)) return <span key={i} className="text-sky-300/90">{p}</span>;
        if (p.startsWith('"')) {
          const col = /BLOCKED|Missing|Blocked|SIMULATION|APPROVED.*CGM/.test(p) ? (p.includes("SIMULATION") ? "text-amber-300/80" : "text-red-400") : p.includes("APPROVED") ? "text-emerald-400" : "text-slate-200";
          return <span key={i} className={col}>{p}</span>;
        }
        if (p === "true") return <span key={i} className="text-emerald-400">{p}</span>;
        if (p === "false") return <span key={i} className="text-red-400">{p}</span>;
        if (/^-?\d/.test(p)) return <span key={i} className="text-amber-300">{p}</span>;
        return <span key={i}>{p}</span>;
      })}
    </pre>
  );
}

/* ---------- Segmented control ---------- */
function Segmented<T extends string>({ value, options, onChange, label, testid }: {
  value: T; options: { v: T; label: string; tone?: string }[]; onChange: (v: T) => void; label: string; testid: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-lg border border-white/[0.08] bg-[#0d1320] p-1">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={o.v} role="radio" aria-checked={on} onClick={() => onChange(o.v)} data-testid={`${testid}-${o.v}`}
            className={`relative z-10 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${on ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>
            {on && <motion.span layoutId={`seg-${testid}`} transition={SPRING} className="absolute inset-0 -z-10 rounded-md border"
              style={{ background: `${o.tone ?? C.cyan}1f`, borderColor: `${o.tone ?? C.cyan}66` }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Node card body ---------- */
function NodeBody({ id, status, scenario, mode, provider, setProvider, compact }: {
  id: NodeId; status: Status; scenario: Scenario; mode: Mode; provider: "A" | "B"; setProvider: (p: "A" | "B") => void; compact?: boolean;
}) {
  const reached = status === "active" || status === "done" || status === "blocked";
  const ok = scenario === "compliant";
  if (status === "absent") return <p className="text-[11px] text-slate-500 leading-snug">Not present without ICDU</p>;
  if (id === "input") return (
    <p className="mono text-[10.5px] leading-snug text-slate-300/90">"{RAW_REQUEST}"</p>
  );
  if (id === "define") {
    const pills = [["Goal", CONTRACT[scenario].goal], ["Context & Expertise", CONTRACT[scenario].context], ["Success Criteria", CONTRACT[scenario].success]];
    return (
      <div className="flex flex-col gap-1.5">
        {pills.map(([k], i) => {
          const missing = !ok && i > 0;
          return (
            <motion.div key={k} initial={false}
              animate={reached ? { opacity: 1, x: 0 } : { opacity: 0.35, x: -4 }}
              transition={{ ...SPRING, delay: reached ? i * 0.18 : 0 }}
              className="flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium"
              style={{ borderColor: reached ? (missing ? `${C.amber}66` : `${C.cyan}55`) : "#ffffff14", background: reached ? (missing ? `${C.amber}12` : `${C.cyan}10`) : "transparent", color: reached ? (missing ? "#fcd34d" : "#bae6fd") : "#64748b" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: reached ? (missing ? C.amber : C.cyan) : "#475569" }} />
              {k}{missing && reached ? " — missing" : ""}
            </motion.div>
          );
        })}
      </div>
    );
  }
  if (id === "gate") {
    const groups = ["Policy Boundaries", "Data Permissions", "Compliance Rules"];
    const checks = gateChecks(scenario);
    return (
      <div className="flex flex-col gap-1">
        {groups.map((g, i) => {
          const pass = checks.filter((c) => c.group === g).every((c) => c.pass);
          const col = !reached ? "#475569" : pass ? C.emerald : C.crimson;
          return (
            <motion.div key={g} initial={false} animate={{ opacity: reached ? 1 : 0.4 }} transition={{ delay: reached ? 0.25 + i * 0.22 : 0 }}
              className="flex items-center justify-between gap-2 text-[10.5px]">
              <span className="text-slate-300">{g}</span>
              <span className="mono text-[9.5px] font-semibold" style={{ color: col }}>{!reached ? "..." : pass ? "PASS" : "FAIL"}</span>
            </motion.div>
          );
        })}
        <AnimatePresence>
          {reached && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ ...SPRING, delay: 0.9 }}
              className="mt-1 rounded-md px-2 py-1 text-[10.5px] font-semibold flex items-center gap-1.5"
              style={{ background: ok ? `${C.emerald}18` : `${C.crimson}18`, color: ok ? "#6ee7b7" : "#fca5a5", border: `1px solid ${ok ? C.emerald : C.crimson}55` }}
              data-testid="status-gate-decision">
              {ok ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {ok ? "Approved to execute" : "Blocked before execution"}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
  if (id === "execute") {
    if (mode === "without") return (
      <div className="text-[10.5px] text-amber-300/90 leading-snug">Any model, any prompt. No bounds applied.</div>
    );
    if (status === "skipped") return (
      <div className="text-[10.5px] leading-snug text-slate-500">Not activated. No model was called and no output exists.</div>
    );
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`grid grid-cols-2 gap-1 ${compact ? "max-w-[220px]" : ""}`} role="radiogroup" aria-label="Model provider">
          {(["A", "B"] as const).map((p) => (
            <button key={p} role="radio" aria-checked={provider === p} aria-label={`Use provider ${p}`} data-testid={`button-provider-${p}`}
              onClick={(e) => { e.stopPropagation(); setProvider(p); }}
              className="rounded-md border px-1.5 py-1 text-[10.5px] font-medium transition-colors"
              style={{ borderColor: provider === p ? `${C.cyan}88` : "#ffffff14", color: provider === p ? "#e0f2fe" : "#94a3b8", background: provider === p ? `${C.cyan}14` : "transparent" }}>
              Provider {p}
            </button>
          ))}
        </div>
        <p className="mono text-[9.5px] text-slate-500">bounds: 4 · contract: locked</p>
      </div>
    );
  }
  // audit
  const blocked = mode === "with" && !ok;
  if (mode === "without") return null;
  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div className="flex justify-between gap-2"><span className="text-slate-500">Intent Hash</span><span className="mono text-slate-300">{reached ? illustrativeHash(JSON.stringify(CONTRACT[scenario])).slice(11, 19) : "--------"}</span></div>
      <div className="flex justify-between gap-2"><span className="text-slate-500">Decision</span><span className="mono font-semibold" style={{ color: !reached ? "#475569" : blocked ? C.crimson : C.emerald }}>{reached ? (blocked ? "BLOCKED" : "APPROVED") : "---"}</span></div>
      <div className="flex justify-between gap-2"><span className="text-slate-500">Policy</span><span className="mono text-slate-300">{reached ? POLICY_VERSION.slice(4, 13) : "---"}</span></div>
      <div className="flex justify-between gap-2"><span className="text-slate-500">Human Review</span><span className="mono" style={{ color: !reached ? "#475569" : blocked ? C.amber : C.emerald }}>{reached ? (blocked ? "Requester fix" : "Ready") : "---"}</span></div>
    </div>
  );
}

const ICONS: Record<NodeId, typeof FileText> = { input: FileText, define: Braces, gate: ShieldCheck, execute: Cpu, audit: ScrollText };

function statusColor(s: Status, id: NodeId, mode: Mode) {
  if (s === "blocked") return C.crimson;
  if (mode === "without" && id === "execute" && (s === "active" || s === "done")) return C.amber;
  if (s === "active") return C.cyan;
  if (s === "done") return C.emerald;
  return "#334155";
}

function NodeCard(props: {
  id: NodeId; status: Status; scenario: Scenario; mode: Mode; provider: "A" | "B"; setProvider: (p: "A" | "B") => void; onSelect: () => void; compact?: boolean;
}) {
  const { id, status, mode, onSelect, compact } = props;
  const meta = NODES.find((n) => n.id === id)!;
  const Icon = id === "gate" && status === "blocked" ? ShieldAlert : ICONS[id];
  const col = statusColor(status, id, mode);
  const live = status === "active" || status === "blocked";
  const dim = status === "skipped" || status === "absent";
  const label = status === "blocked" ? "Blocked" : status === "active" ? "Active" : status === "done" ? "Complete" : status === "skipped" ? "Bypassed" : status === "absent" ? "Absent" : "Waiting";
  return (
    <motion.div
      role="button" tabIndex={dim ? -1 : 0} onClick={dim ? undefined : onSelect}
      onKeyDown={(e) => { if (!dim && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); onSelect(); } }}
      aria-label={`${meta.label} stage, ${label}. ${dim ? "" : "Select to inspect."}`}
      data-testid={`card-node-${id}`}
      initial={false}
      animate={{ scale: live ? 1.035 : 1, opacity: dim ? 0.38 : 1, y: live ? -3 : 0 }}
      transition={SPRING}
      className={`glass relative w-full rounded-xl border text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 ${dim ? "cursor-default" : "cursor-pointer"} ${compact ? "p-4" : "p-3"}`}
      style={{
        borderColor: live ? `${col}99` : status === "done" ? `${col}55` : "rgba(255,255,255,0.08)",
        boxShadow: live ? `0 0 0 1px ${col}33, 0 18px 50px -18px ${col}88` : "0 10px 30px -20px rgba(0,0,0,.8)",
        borderStyle: dim ? "dashed" : "solid",
      }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md border" style={{ borderColor: `${col}66`, background: `${col}14`, color: col === "#334155" ? "#94a3b8" : col }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-[12.5px] font-semibold tracking-wide text-slate-100 leading-none">{meta.label}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{meta.blurb}</div>
          </div>
        </div>
        <span className="mono text-[9px] text-slate-600">{meta.kicker}</span>
      </div>
      <NodeBody {...props} />
      <div className="mt-2 flex items-center gap-1.5 text-[9.5px] mono uppercase tracking-wider" style={{ color: col === "#334155" ? "#64748b" : col }}>
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: col }} />
        {label}
      </div>
    </motion.div>
  );
}

/* ---------- SVG edge ---------- */
function Edge({ d, state, color, dur, reduced, dashed, testid }: {
  d: string; state: "off" | "flow" | "on" | "ghost"; color: string; dur: number; reduced: boolean; dashed?: boolean; testid: string;
}) {
  return (
    <g data-testid={testid}>
      <path d={d} fill="none" stroke={state === "ghost" ? "#1e293b" : "#1f2a3d"} strokeWidth={2} strokeDasharray={dashed || state === "ghost" ? "5 6" : undefined} />
      {(state === "flow" || state === "on") && (
        <>
          <motion.path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" opacity={0.18} filter="url(#blur6)"
            initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : dur * 0.55, ease: "easeInOut" }} />
          <motion.path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
            initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : dur * 0.55, ease: "easeInOut" }} />
          {!reduced && (
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="3 14" opacity={0.7}>
              <animate attributeName="stroke-dashoffset" from="34" to="0" dur={`${dur / 2}s`} repeatCount="indefinite" />
            </path>
          )}
        </>
      )}
      {state === "flow" && !reduced && [0, 0.33, 0.66].map((o) => (
        <g key={o}>
          <circle r={7} fill={color} opacity={0.25} filter="url(#blur4)">
            <animateMotion dur={`${dur * 0.8}s`} begin={`${o * dur * 0.8}s`} repeatCount="indefinite" path={d} />
          </circle>
          <circle r={3} fill="#f0f9ff">
            <animateMotion dur={`${dur * 0.8}s`} begin={`${o * dur * 0.8}s`} repeatCount="indefinite" path={d} />
          </circle>
        </g>
      ))}
    </g>
  );
}

/* ---------- Inspector ---------- */
function Inspector({ node, mode, scenario, provider, status }: { node: NodeId; mode: Mode; scenario: Scenario; provider: "A" | "B"; status: Status }) {
  const [copied, setCopied] = useState(false);
  const { payload, title, kind } = useMemo(() => {
    if (mode === "without") {
      return node === "input"
        ? { payload: RAW_REQUEST, title: "Raw prompt", kind: "text" as const }
        : { payload: UNGUARDED_OUTPUT, title: "Unguarded model response", kind: "json" as const };
    }
    switch (node) {
      case "input": return { payload: RAW_REQUEST, title: "Raw work request", kind: "text" as const };
      case "define": return { payload: contractJson(scenario), title: "Intent Contract", kind: "json" as const };
      case "gate": return { payload: { _notice: "SIMULATION - sample policy checks", policy_version: POLICY_VERSION, checks: gateChecks(scenario) }, title: "Gate checklist", kind: "checks" as const };
      case "execute": return { payload: boundedPayload(provider), title: `Bounded response · Provider ${provider}`, kind: "json" as const };
      case "audit": return { payload: auditRecord(scenario), title: "Audit evidence", kind: "json" as const };
    }
  }, [node, mode, scenario, provider]);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  const download = () => {
    const blob = new Blob([text], { type: typeof payload === "string" ? "text/plain" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `icdu-sim-${mode}-${scenario}-${node}.${typeof payload === "string" ? "txt" : "json"}`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const stages: NodeId[] = mode === "without" ? ["input", "execute"] : ["input", "define", "gate", "execute", "audit"];
  const kindLabel: Record<NodeId, string> = { input: "raw text", define: "structured JSON", gate: "gate checklist", execute: mode === "without" ? "unguarded output" : "bounded response", audit: "audit evidence" };

  return (
    <section aria-labelledby="inspector-title" className="glass rounded-2xl border border-white/[0.08] overflow-hidden" data-testid="panel-inspector">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Payload & Evidence Inspector</span>
          <span className="h-3 w-px bg-white/10" />
          <h2 id="inspector-title" className="text-sm font-semibold text-slate-100 truncate" data-testid="text-inspector-title">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copy} aria-label="Copy payload to clipboard" data-testid="button-copy-payload"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/50 hover:text-white transition-colors">
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
          </button>
          <button onClick={download} aria-label="Download payload as file" data-testid="button-download-payload"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-400/50 hover:text-white transition-colors">
            <Download className="h-3.5 w-3.5" />Download
          </button>
        </div>
      </header>
      <div className="flex gap-1 overflow-x-auto px-5 pt-3" aria-hidden>
        {stages.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <span className={`mono rounded px-2 py-0.5 text-[10.5px] ${s === node ? "bg-sky-400/15 text-sky-200" : "text-slate-600"}`}>{kindLabel[s]}</span>
            {i < stages.length - 1 && <ArrowRight className="h-3 w-3 text-slate-700" />}
          </div>
        ))}
      </div>
      <div className="relative min-h-[260px] px-5 py-4">
        <AnimatePresence mode="wait">
          <motion.div key={`${node}-${mode}-${scenario}-${provider}-${status}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
            {status === "idle" ? (
              <div className="grid min-h-[220px] place-items-center text-center">
                <div>
                  <div className="mx-auto mb-3 h-10 w-10 rounded-full border border-dashed border-slate-700" />
                  <p className="text-sm text-slate-400">This stage has not run yet.</p>
                  <p className="text-xs text-slate-600 mt-1">Press play or step forward to reach it.</p>
                </div>
              </div>
            ) : kind === "text" ? (
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 mb-2">Unstructured · sample data</p>
                <p className="mono text-[15px] leading-relaxed text-slate-100 border-l-2 border-sky-400/60 pl-4" data-testid="text-raw-request">"{RAW_REQUEST}"</p>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                  {["role: none", "purpose: none", "scope: unbounded", "criteria: none"].map((t) => (
                    <span key={t} className="mono rounded border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-amber-300/90">{t}</span>
                  ))}
                </div>
              </div>
            ) : kind === "checks" ? (
              <ul className="grid gap-2 md:grid-cols-2" data-testid="list-gate-checks">
                {gateChecks(scenario).map((c, i) => (
                  <motion.li key={c.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...SPRING, delay: i * 0.07 }}
                    className="flex gap-3 rounded-lg border px-3 py-2.5"
                    style={{ borderColor: c.pass ? `${C.emerald}33` : `${C.crimson}55`, background: c.pass ? `${C.emerald}08` : `${C.crimson}0d` }}>
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full" style={{ background: c.pass ? C.emerald : C.crimson }}>
                      {c.pass ? <CheckIcon className="h-2.5 w-2.5 text-[#090D16]" strokeWidth={3} /> : <X className="h-2.5 w-2.5 text-[#090D16]" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{c.group}</div>
                      <div className="text-[13px] text-slate-100">{c.name}</div>
                      <div className={`mono text-[11px] mt-0.5 ${c.pass ? "text-slate-400" : "text-red-300"}`}>{c.detail}</div>
                    </div>
                  </motion.li>
                ))}
              </ul>
            ) : (
              <>
                {mode === "without" && node === "execute" && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12.5px] text-amber-200">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />No intent contract, no gate, no evidence. This response cannot be traced or defended.
                  </div>
                )}
                {node === "audit" && scenario === "ungoverned" && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-[12.5px] text-red-200" data-testid="status-audit-blocked">
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />Decision BLOCKED. Execution never started, so no model output exists in this record.
                  </div>
                )}
                <JsonView value={payload} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className="mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider" style={{ borderColor: `${tone}55`, color: tone, background: `${tone}10` }}>{children}</span>;
}

/* ---------- Page ---------- */
export default function Explorer() {
  const reduced = !!useReducedMotion();
  const [mode, setMode] = useState<Mode>("with");
  const [scenario, setScenario] = useState<Scenario>("compliant");
  const [provider, setProvider] = useState<"A" | "B">("A");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [speed, setSpeed] = useState<1 | 1.5>(1);
  const [inspect, setInspect] = useState<NodeId | null>(null);

  const seq = useMemo(() => sequence(mode, scenario), [mode, scenario]);
  const current = seq[idx];
  const last = idx >= seq.length - 1;
  const dur = 1.9 / speed;

  useEffect(() => {
    if (!playing) return;
    if (last) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, seq.length - 1)), STEP_MS / speed);
    return () => clearTimeout(t);
  }, [playing, idx, last, speed, seq.length]);

  const restart = useCallback((play = true) => { setIdx(0); setInspect(null); setPlaying(play && !reduced); }, [reduced]);
  const changeMode = (m: Mode) => { setMode(m); restart(); };
  const changeScenario = (s: Scenario) => { setScenario(s); if (mode === "without") setMode("with"); restart(); };
  const step = useCallback((d: number) => { setPlaying(false); setInspect(null); setIdx((i) => Math.max(0, Math.min(seq.length - 1, i + d))); }, [seq.length]);
  const togglePlay = useCallback(() => {
    setInspect(null);
    setPlaying((p) => { if (!p && last) { setIdx(0); } return !p; });
  }, [last]);

  const keyRef = useRef({ step, togglePlay });
  keyRef.current = { step, togglePlay };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || tag === "INPUT" || (e.target as HTMLElement).getAttribute("role") === "button") return;
      if (e.key === " ") { e.preventDefault(); keyRef.current.togglePlay(); }
      if (e.key === "ArrowRight") keyRef.current.step(1);
      if (e.key === "ArrowLeft") keyRef.current.step(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const statusOf = (id: NodeId): Status => {
    const p = seq.indexOf(id);
    if (p === -1) return mode === "without" ? "absent" : "skipped";
    const blockedGate = id === "gate" && scenario === "ungoverned" && mode === "with";
    if (p > idx) return "idle";
    if (blockedGate) return "blocked";
    return p === idx ? "active" : "done";
  };
  const reachedIdx = (id: NodeId) => seq.indexOf(id);
  const edgeState = (from: NodeId, to: NodeId): "off" | "flow" | "on" | "ghost" => {
    const a = reachedIdx(from), b = reachedIdx(to);
    if (a === -1 || b === -1 || b !== a + 1) return "ghost";
    if (idx < b) return "off";
    return idx === b ? "flow" : "on";
  };

  const inspectNode = inspect ?? current;
  const selectNode = (id: NodeId) => {
    const p = seq.indexOf(id);
    if (p === -1) return;
    setPlaying(false);
    if (p <= idx) setInspect(id); else { setIdx(p); setInspect(null); }
  };

  const blockedPath = mode === "with" && scenario === "ungoverned";
  const bypassState: "off" | "flow" | "on" = !blockedPath ? "off" : idx < 3 ? "off" : "flow";
  const outcome = mode === "without" ? { t: "Ungoverned", c: C.amber } : blockedPath ? { t: "Blocked at gate", c: C.crimson } : { t: "Governed & approved", c: C.emerald };

  return (
    <div className="grain relative min-h-[100dvh] bg-[#090D16] text-slate-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-70" style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(56,189,248,0.10), transparent 70%)" }} />
      <div className="relative z-10 mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 pb-16">
        {/* top bar */}
        <nav className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-sky-400/40 bg-sky-400/10">
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden><path d="M3 10h4l2-5 2 10 2-5h4" stroke={C.cyan} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-white">ICDU</div>
              <div className="text-[11px] text-slate-500">AI Guided by Intent</div>
            </div>
          </div>
          <Pill tone={C.amber}><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Simulation · sample data</Pill>
        </nav>

        {/* hero */}
        <header className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <h1 className="text-[34px] sm:text-[44px] lg:text-[52px] font-semibold tracking-[-0.035em] leading-[1.02] text-white">
              Every AI action starts<br />as an <span className="text-sky-400">intent</span>, not a prompt.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
              ICDU is a readiness and governance control plane. Follow one request through Define, Gate, Execute and Audit, and see what changes when context or authorization is missing.
            </p>
          </div>
          <div className="glass rounded-2xl border border-white/[0.08] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Scenario</span>
              <Segmented label="Scenario" testid="toggle-scenario" value={scenario} onChange={changeScenario}
                options={[{ v: "compliant", label: "Compliant request", tone: C.emerald }, { v: "ungoverned", label: "Missing context", tone: C.crimson }]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Comparison</span>
              <Segmented label="Comparison" testid="toggle-mode" value={mode} onChange={changeMode}
                options={[{ v: "without", label: "Without ICDU", tone: C.amber }, { v: "with", label: "With ICDU", tone: C.cyan }]} />
            </div>
          </div>
        </header>

        {/* canvas */}
        <section aria-label="ICDU architecture flow" className="mt-8 glass rounded-2xl border border-white/[0.08] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full" style={{ background: outcome.c, boxShadow: `0 0 12px ${outcome.c}` }} />
              <span className="text-sm font-medium text-slate-100" data-testid="status-outcome">{outcome.t}</span>
              <span className="mono text-[11px] text-slate-500">step {idx + 1}/{seq.length}</span>
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Playback controls">
              <button onClick={() => step(-1)} disabled={idx === 0} aria-label="Step back" data-testid="button-step-back" className="ctl"><SkipBack className="h-4 w-4" /></button>
              <button onClick={togglePlay} aria-label={playing ? "Pause" : last ? "Replay" : "Play"} data-testid="button-play-pause"
                className="grid h-9 w-9 place-items-center rounded-full bg-sky-400 text-[#090D16] hover:bg-sky-300 transition-colors">
                {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" />}
              </button>
              <button onClick={() => step(1)} disabled={last} aria-label="Step forward" data-testid="button-step-forward" className="ctl"><SkipForward className="h-4 w-4" /></button>
              <button onClick={() => restart(false)} aria-label="Reset to start" data-testid="button-reset" className="ctl"><RotateCcw className="h-4 w-4" /></button>
              <div className="ml-1 inline-flex rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label="Playback speed">
                {([1, 1.5] as const).map((s) => (
                  <button key={s} role="radio" aria-checked={speed === s} aria-label={`Speed ${s}x`} onClick={() => setSpeed(s)} data-testid={`button-speed-${s}`}
                    className={`mono rounded px-2 py-1 text-[11px] ${speed === s ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>{s}x</button>
                ))}
              </div>
            </div>
          </div>

          {/* narration */}
          <div className="px-5 pt-4" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.p key={`${mode}${scenario}${current}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="text-[14px] text-slate-300 max-w-3xl" data-testid="text-narration">
                <span className="mono mr-2 text-sky-400">{NODES.find((n) => n.id === current)?.label}</span>{narration(mode, scenario, current)}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* wide layout */}
          <div className="hidden xl:block px-5 py-4">
            <div className="relative w-full" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
              <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full" aria-hidden>
                <defs>
                  <filter id="blur6" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
                  <filter id="blur4" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="4" /></filter>
                </defs>
                {mode === "with" ? (
                  <>
                    {EDGES.map((e) => (
                      <Edge key={e.id} testid={`edge-${e.id}`} d={e.d} dur={dur} reduced={reduced}
                        state={blockedPath && e.id === "e3" ? "ghost" : blockedPath && e.id === "e4" ? "ghost" : edgeState(e.from, e.to)}
                        color={e.id === "e4" || (e.id === "e3") ? C.emerald : C.cyan} />
                    ))}
                    {blockedPath && (
                      <>
                        <Edge testid="edge-bypass" d={BYPASS_D} state={bypassState} color={C.crimson} dur={dur} reduced={reduced} dashed />
                        <text x={(CX.gate + CX.audit) / 2} y={VB_H - 20} textAnchor="middle" className="mono" fontSize="11" fill={bypassState === "off" ? "#475569" : "#fca5a5"} letterSpacing="1.5">
                          BYPASS TO AUDIT · NO EXECUTION
                        </text>
                        <g transform={`translate(${(CX.gate + CX.execute) / 2}, ${CY})`} opacity={idx >= 2 ? 1 : 0.3}>
                          <circle r="12" fill="#090D16" stroke={C.crimson} strokeWidth="1.5" />
                          <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke={C.crimson} strokeWidth="2" strokeLinecap="round" />
                        </g>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {EDGES.map((e) => <Edge key={e.id} testid={`edge-${e.id}`} d={e.d} state="ghost" color={C.cyan} dur={dur} reduced={reduced} />)}
                    <Edge testid="edge-direct" d={DIRECT_D} state={idx >= 1 ? "flow" : "off"} color={C.amber} dur={dur} reduced={reduced} />
                    <text x={(CX.input + CX.execute) / 2} y={34} textAnchor="middle" fontSize="11" className="mono" fill="#fcd34d" letterSpacing="1.5">DIRECT PROMPT · NO CONTRACT · NO GATE · NO EVIDENCE</text>
                  </>
                )}
              </svg>
              {NODES.map((n) => (
                <div key={n.id} className="absolute -translate-y-1/2" style={{ left: `${((CX[n.id] - NW / 2) / VB_W) * 100}%`, width: `${(NW / VB_W) * 100}%`, top: `${(CY / VB_H) * 100}%` }}>
                  <NodeCard id={n.id} status={statusOf(n.id)} scenario={scenario} mode={mode} provider={provider} setProvider={setProvider} onSelect={() => selectNode(n.id)} />
                </div>
              ))}
            </div>
          </div>

          {/* stacked layout */}
          <ol className="xl:hidden px-5 py-5 grid gap-0 md:grid-cols-2 md:gap-x-6">
            {NODES.map((n, i) => {
              const s = statusOf(n.id);
              const nextLit = i < NODES.length - 1 && (s === "done" || s === "blocked");
              return (
                <li key={n.id} className="flex flex-col md:mb-4">
                  <NodeCard compact id={n.id} status={s} scenario={scenario} mode={mode} provider={provider} setProvider={setProvider} onSelect={() => selectNode(n.id)} />
                  {i < NODES.length - 1 && (
                    <div className="relative mx-auto h-8 w-px bg-slate-800 md:hidden" aria-hidden>
                      <motion.div className="absolute inset-0 origin-top" initial={false} animate={{ scaleY: nextLit ? 1 : 0 }} transition={SPRING}
                        style={{ background: blockedPath && n.id === "gate" ? C.crimson : mode === "without" ? C.amber : C.cyan }} />
                    </div>
                  )}
                  {blockedPath && n.id === "execute" && (
                    <p className="mono mt-2 mb-1 text-[11px] text-red-300/80">Bypass connector: GATE to AUDIT, execution skipped</p>
                  )}
                </li>
              );
            })}
          </ol>

          {/* progress */}
          <div className="flex gap-1.5 px-5 pb-4" aria-hidden>
            {seq.map((s, i) => (
              <div key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div className="h-full origin-left" initial={false} animate={{ scaleX: i <= idx ? 1 : 0 }} transition={SPRING}
                  style={{ background: s === "gate" && blockedPath ? C.crimson : mode === "without" ? C.amber : i === idx ? C.cyan : C.emerald }} />
              </div>
            ))}
          </div>
        </section>

        {/* inspector + legend */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <Inspector node={inspectNode} mode={mode} scenario={scenario} provider={provider} status={statusOf(inspectNode)} />
          <aside className="glass rounded-2xl border border-white/[0.08] p-5 text-[13px]">
            <h3 className="text-[11px] uppercase tracking-[0.16em] text-slate-500 mb-3">Reading the flow</h3>
            <ul className="space-y-2.5">
              {[[C.cyan, "Data in motion"], [C.emerald, "Approved / complete"], [C.amber, "Intervention needed or ungoverned"], [C.crimson, "Blocked before execution"]].map(([c, t]) => (
                <li key={t} className="flex items-center gap-2.5"><span className="h-2 w-6 rounded-full" style={{ background: c }} /><span className="text-slate-300">{t}</span></li>
              ))}
            </ul>
            <div className="my-4 h-px bg-white/[0.06]" />
            <h3 className="text-[11px] uppercase tracking-[0.16em] text-slate-500 mb-2">Shortcuts</h3>
            <p className="text-slate-400"><kbd className="mono rounded border border-white/10 px-1">Space</kbd> play or pause · <kbd className="mono rounded border border-white/10 px-1">Left</kbd>/<kbd className="mono rounded border border-white/10 px-1">Right</kbd> step. Select any reached node to inspect it.</p>
            <div className="my-4 h-px bg-white/[0.06]" />
            <p className="text-[12px] leading-relaxed text-slate-500">
              Educational simulation. Patient #4092 and all records are synthetic. Hashes are illustrative digests, not production immutable records. No model is called.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
