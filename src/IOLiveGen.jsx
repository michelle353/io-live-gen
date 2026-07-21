import { useState, useEffect, useRef } from "react";

const C = {
  ink: "#2D1060", hdr: "#4A2480", pur: "#7B52AB", mid: "#9B72CB",
  lav: "#C9B8F0", soft: "#F7F5FB", pale: "#EAE4F5", white: "#FFFFFF",
  charcoal: "#2C2C3A", muted: "#6B6B80", border: "#E4E0F0",
  grn: "#1A7A4A", grnBg: "#EAF7F0", grnBorder: "#A8DFC0",
  amb: "#7B5200", ambBg: "#FFF8E7",
};

const RESEARCH_STEPS = [
  "Locating organization profile…",
  "Scanning CRA T3010 filings…",
  "Reading annual report acknowledgements…",
  "Identifying current funders and sponsors…",
  "Inferring funding gaps…",
  "Building intake profile…",
];

const GEN_STEPS = [
  "Scanning funding landscape…",
  "Identifying signal opportunities…",
  "Qualifying funder portfolio openness…",
  "Building target set…",
  "Applying evidence chain standards…",
  "Validating contact pathways…",
  "Drafting strategic observations…",
  "Compiling intelligence package…",
];

const BUDGET_OPTIONS = ["Under $500K","$500K – $1M","$1M – $3M","$3M – $10M","Over $10M"];
const FOCUS_OPTIONS = [
  "Health & Mental Wellness","Women's Economic Security / GBV",
  "Community Safety & Social Services","Education & Youth Development",
  "Environment & Climate","Arts, Culture & Heritage",
  "Housing & Homelessness","Indigenous Communities",
  "Settlement & Immigration","Research & Innovation",
  "Professional Association","Other / Multiple",
];
const GEO_OPTIONS = [
  "Local / Municipal","Regional (e.g. GTA, Halton)",
  "Provincial","National (Canada)","International",
];

const MIN_TARGETS = 10;

const emptyIntake = () => ({
  orgName:"", orgType:"", mission:"", geography:"",
  audience:"", audienceSize:"", influence:"",
  fundingGoal:"Both -- sponsors and grants / funders",
  currentFunding:"", gaps:"", annualBudget:"", location:"", sector:"",
});

export default function IOLiveGen() {
  const [screen, setScreen]       = useState("orient");
  const [orgName, setOrgName]     = useState("");
  const [budget, setBudget]       = useState("");
  const [focus, setFocus]         = useState("");
  const [geo, setGeo]             = useState("");
  const [intake, setIntake]       = useState(emptyIntake());
  const [intel, setIntel]         = useState(null);
  const [emails, setEmails]       = useState(null);   // lightweight email drafts
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [debugLog, setDebugLog]   = useState([]);
  const [retryCount, setRetryCount] = useState(0);
  const [stepIdx, setStepIdx]     = useState(0);
  const [activeSteps, setActiveSteps] = useState(GEN_STEPS);
  const stepTimer = useRef(null);

  useEffect(() => {
    if (screen !== "researching" && screen !== "generating") return;
    const steps = screen === "researching" ? RESEARCH_STEPS : GEN_STEPS;
    setActiveSteps(steps);
    setStepIdx(0);
    let i = 0;
    stepTimer.current = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setStepIdx(i);
    }, screen === "researching" ? 1200 : 1400);
    return () => clearInterval(stepTimer.current);
  }, [screen]);

  const canOrient = orgName.trim().length >= 3 && budget && focus && geo;

  // ── STEP 1: Research ───────────────────────────────────────────────────────
  // ── Shared: extract + parse JSON from any API response ───────────────────
  const extractJSON = (data) => {
    // Collect all text blocks (may come after tool_use / tool_result blocks)
    const allText = (data.content||[])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");
    // Also check inside tool_result content blocks (web search sometimes embeds there)
    const toolResultText = (data.content||[])
      .filter(b => b.type === "tool_result")
      .flatMap(b => (b.content||[]).filter(c=>c.type==="text").map(c=>c.text))
      .join("\n");
    const combined = allText + "\n" + toolResultText;
    // Strip markdown fences if present
    const stripped = combined.replace(/```(?:json)?\s*/gi,"").replace(/```\s*/g,"");
    // Find the outermost JSON object
    const start = stripped.indexOf("{");
    const end   = stripped.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(stripped.slice(start, end + 1));
  };

  const researchOrg = async () => {
    setScreen("researching");
    setError(null);

    const SYSTEM = `You are a Canadian nonprofit research specialist with deep knowledge of the Canadian charitable sector.

Your job: given an organization name, populate a complete intake profile JSON using your training knowledge. Be specific and confident. Do not hedge unnecessarily. If you know the org, say what you know. If you are inferring, note it briefly inline.

For current funders: name specific government programs, foundations, and corporate sponsors known to fund this type of organization in this geography. If you know this specific org's funders, name them. If not, name the most likely funders for this sector and geography and mark them "(likely)".

CRITICAL: Output ONLY the raw JSON object below. No preamble. No markdown. No explanation. Start your response with { and end with }.

{
  "orgName": "Full official organization name",
  "orgType": "Registered Charity / Professional Association / Social Enterprise / NFP",
  "mission": "2–3 sentences. Their mission and primary programs.",
  "geography": "Specific geography they serve",
  "location": "City, Province",
  "sector": "Primary sector",
  "audience": "Who they serve — specific populations and how",
  "audienceSize": "Estimated reach or membership",
  "influence": "What decisions their audience influences",
  "currentFunding": "Named funders — government programs, foundations, corporate sponsors. Comma-separated. Mark uncertain ones (likely) or (unconfirmed).",
  "gaps": "Specific funders or categories likely absent. Be direct.",
  "annualBudget": "Best estimate",
  "confidence": "High / Medium / Low"
}`;

    const USER = `Organization: ${orgName.trim()}
Approximate Budget: ${budget}
Primary Focus: ${focus}
Geographic Reach: ${geo}

Populate the full intake profile. Be specific about funders — this is the most important field. Start your response with { immediately.`;

    let profile = null;
    const log = [];
    try {
      log.push("→ Sending API request…");
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{ role: "user", content: USER }],
        }),
      });
      log.push(`→ HTTP status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        const textBlocks = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text);
        log.push(`→ Content blocks: ${data.content?.length || 0} (text blocks: ${textBlocks.length})`);
        log.push(`→ Raw text (first 300 chars): ${textBlocks.join("").slice(0,300)}`);
        log.push(`→ Stop reason: ${data.stop_reason}`);
        profile = extractJSON(data);
        log.push(`→ Profile extracted: ${profile ? "YES — " + Object.keys(profile).join(", ") : "NO"}`);
      } else {
        const errData = await res.json().catch(()=>({}));
        log.push(`→ API error: ${JSON.stringify(errData).slice(0,200)}`);
      }
    } catch(e) {
      log.push(`→ Exception: ${e.message}`);
    }
    setDebugLog(log);

    // ── Apply whatever we have ───────────────────────────────────────────────
    if (profile && (profile.mission || profile.audience || profile.currentFunding)) {
      setIntake({
        orgName:       profile.orgName        || orgName.trim(),
        orgType:       profile.orgType        || "",
        mission:       profile.mission        || "",
        geography:     profile.geography      || geo,
        location:      profile.location       || "",
        sector:        profile.sector         || focus,
        audience:      profile.audience       || "",
        audienceSize:  profile.audienceSize   || "",
        influence:     profile.influence      || "",
        fundingGoal:   "Both -- sponsors and grants / funders",
        currentFunding: profile.currentFunding || "",
        gaps:          profile.gaps           || "",
        annualBudget:  profile.annualBudget   || budget,
        _confidence:   profile.confidence     || "Medium",
      });
    } else {
      // Full fallback — pre-fill what we know from the orient screen
      setIntake({
        ...emptyIntake(),
        orgName:      orgName.trim(),
        geography:    geo,
        sector:       focus,
        annualBudget: budget,
        _confidence:  "Low",
      });
      setError("Limited public data found for this organization — please fill in the fields below.");
    }
    setScreen("intake");
  };

  // ── STEP 2: Generate intelligence + kick off email call ───────────────────
  const generate = async (isRetry = false) => {
    setScreen("generating");
    setEmails(null);
    if (!isRetry) setRetryCount(0);

    const SYSTEM = `You are the Infinite Opportunity™ intelligence engine — built by The Infinite CDO Advisory (Michelle Ghai, CPA, MBA, former RBC and TD Bank executive, Board Director).
Output ONLY valid JSON — no preamble, no markdown, no explanation.

RULE 11 — TONE: Advisor beside the client. Calibrated language: "may indicate / may suggest / worth monitoring / potential signal / possible opportunity / timing may be favourable". NEVER use: weak / lacking / fragile / absent / missing / problem / failure / vulnerable / exposed / poor / inadequate / leaving money on the table / significant gaps / heavily reliant.

RULE 12 — EVIDENCE CHAIN: Every target: exact signal, classification (Verified/Strong Inference/Strategic Hypothesis), confidence (High/Medium/Low), why it may matter, action, validation step.

T3010 STANDARD: Open→Attainable Now / Mixed→Build Toward / Closed→Aspirational (add T3010 review note) / Unknown→Build Toward (add CRA Charity Search note). Government funders exempt. Every foundation carries t3010signal note.

OUTPUT SCHEMA:
{
  "summary": "3–4 sentences. Strategic assessment. Board-ready.",
  "opportunityRange": "$XXK – $XXXK",
  "targets": [{
    "name": "Full funder name",
    "category": "Federal Program Grant / Provincial Grant / Corporate Foundation / Private Foundation / Corporate CSR / Corporate Sponsor",
    "range": "$XXK – $XXXK",
    "priority": "HIGH or MONITOR",
    "why": "2–3 sentences. All four IO questions. t3010signal note for foundations.",
    "reachability": "Attainable Now — Direct Application / Attainable Now — Direct Outreach / Attainable Now — Renewal Conversation / Build Toward — Introductory Call First / Build Toward — LOI After Stream Confirmed / Aspirational — T3010 Review First",
    "signal": "One sentence: exact observable event or condition.",
    "action": "One sentence: specific relationship-first action.",
    "validate": "One sentence: concrete validation step with time estimate.",
    "signalClass": "Verified / Strong Inference / Strategic Hypothesis",
    "confidence": "High / Medium / Low",
    "horizon": "Near-Term or Longer-Term",
    "contact": "Best contact name + email or portal URL",
    "contactStatus": "VERIFIED / CONSTRUCTED / PATH / PORTAL-ONLY"
  }],
  "actions": [{
    "action": "Specific step — who, what, why now.",
    "target": "Organization name",
    "timeline": "Days 0–14 / Days 0–30 / Days 15–45 / Days 30–60",
    "owner": "ED / Development Team / Board"
  }],
  "observations": ["Strategic observation — executive judgment, pattern-level, board-ready."]
}

QUALITY: Minimum ${MIN_TARGETS} targets (mix HIGH/MONITOR). 5–6 actions. 3–4 observations. Output ONLY JSON.

════════════════════════════════════════════════════════════
EVIDENCE GATE — APPLY BEFORE EVERY CLASSIFICATION DECISION
════════════════════════════════════════════════════════════

GATE 1 — PROGRAM STATUS (apply before any "Attainable Now" label):
Before labelling a named program or funding stream as "Attainable Now," confirm it is currently active.
- If a program is historical, closed, paused, or renamed: use "Build Toward" or "Aspirational" and note in the "why" field: "Program closed — [current successor or alternative stream] is the current pathway."
- If a successor program exists, surface the CURRENT program name — not the historical one.
- Historical evidence (e.g. prior grants received) remains useful for relationship intelligence but must be labelled as such. Never present a closed program as an open opportunity.

GATE 2 — RENEWAL CONVERSATION (apply before any "Renewal" reachability label):
"Attainable Now — Renewal Conversation" requires evidence of a current or prior funding relationship.
Evidence includes: named in annual report acknowledgements, CRA T3010 recipient list, public grant announcement, or direct knowledge of existing relationship.
If evidence is absent or uncertain, use "Build Toward — Introductory Call First" instead.
In the "validate" field, note: "Confirm existing relationship internally before outreach."
Never assign "Renewal Conversation" solely because the organization and funder appear well-aligned.

GATE 3 — CONFIDENCE FLOOR (apply before priority assignment):
- "Strategic Hypothesis" classification ALWAYS yields Low confidence and MONITOR priority. No exceptions.
- "Strong Inference" may yield Medium confidence and HIGH priority only if program eligibility and fit are clearly supported.
- "Verified" may yield High or Medium confidence depending on timing and pathway clarity.
A strategically compelling idea does not earn High confidence. Evidence does.

GATE 4 — OPPORTUNITY RANGE (apply before setting opportunityRange):
The headline opportunityRange must reflect only targets classified as Verified or Strong Inference.
Do NOT include Strategic Hypothesis targets in the aggregate range.
If fewer than 5 targets meet this threshold, set opportunityRange to reflect the validated subset and note it in the summary as: "range reflects confirmed pipeline — additional strategic prospects are identified and require further validation."
Never create false precision. A defensible narrower range is better than an inflated one.`;

    const USER = `Generate intelligence for:
Organization: ${intake.orgName}
Type: ${intake.orgType}
Mission: ${intake.mission}
Geography: ${intake.geography} | Location: ${intake.location} | Sector: ${intake.sector}
Audience: ${intake.audience} | Size: ${intake.audienceSize}
Audience Influence: ${intake.influence}
Funding Goal: ${intake.fundingGoal}
Current Funders (researched): ${intake.currentFunding}
Funding Gaps: ${intake.gaps}
Annual Budget: ${intake.annualBudget}
Date: ${new Date().toLocaleDateString("en-CA",{month:"long",year:"numeric"})}

Apply Rule 11, Rule 12, T3010 standard. Minimum ${MIN_TARGETS} targets. Return exact JSON schema.`;

    try {
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 8000,
          system: SYSTEM,
          messages: [{ role: "user", content: USER }],
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const raw = data.content?.find(b=>b.type==="text")?.text||"";
      const cleaned = raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Malformed output. Tap Retry.");
      const parsed = JSON.parse(match[0]);
      if (!parsed.targets||parsed.targets.length < MIN_TARGETS) {
        const count = parsed.targets?.length||0;
        if (!isRetry&&retryCount<1) { setRetryCount(1); return generate(true); }
        throw new Error(`Only ${count} targets returned (minimum ${MIN_TARGETS}). Tap Retry.`);
      }
      setIntel(parsed);
      setScreen("review");
      // Kick off email generation in background immediately
      generateEmails(parsed, intake);
    } catch (e) {
      setError(e.message||"Unexpected error.");
      setScreen("intake");
    }
  };

  // ── BACKGROUND: Generate email drafts ─────────────────────────────────────
  const generateEmails = async (intelData, intakeData) => {
    setEmailsLoading(true);
    const highTargets = (intelData.targets||[]).filter(t=>t.priority==="HIGH").slice(0,3);
    if (highTargets.length === 0) { setEmailsLoading(false); return; }

    const SYSTEM = `You are drafting outreach emails on behalf of an Executive Director of a Canadian nonprofit. 
Write peer-to-peer emails — ED to funder program officer or corporate contact. 
NOT grant-writer language. Warm, direct, specific. Reference the exact signal that makes this timely.
Output ONLY valid JSON — no preamble, no markdown:
{
  "emails": [
    {
      "to": "Funder name",
      "subject": "Subject line — specific, not generic",
      "body": "Full email body. 3–4 short paragraphs. ~120–150 words. Reference the specific signal. Name the org and its work. Make a specific ask — a call, coffee, or intro meeting. Sign off as [ED Name], Executive Director, [Org Name]."
    }
  ]
}`;

    const USER = `Write 3 outreach emails for the Executive Director of ${intakeData.orgName}.

Organization mission: ${intakeData.mission}
Geographic reach: ${intakeData.geography}

Draft one email per funder below. Each email must reference the specific signal noted.

${highTargets.map((t,i)=>`EMAIL ${i+1}:
Funder: ${t.name}
Signal: ${t.signal}
Why it matters: ${t.why}
Suggested action: ${t.action}
Contact status: ${t.contactStatus||"PATH"}`).join("\n\n")}

Tone: warm, direct, peer-to-peer. Not a grant application. A relationship-opening conversation.`;

    try {
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 2500,
          system: SYSTEM,
          messages: [{ role: "user", content: USER }],
        }),
      });
      if (!res.ok) throw new Error("Email generation failed.");
      const data = await res.json();
      const raw = data.content?.find(b=>b.type==="text")?.text||"";
      const cleaned = raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setEmails(parsed.emails||[]);
      }
    } catch { /* silent — emails are bonus, not blocking */ }
    setEmailsLoading(false);
  };

  const reset = () => {
    setScreen("orient"); setOrgName(""); setBudget(""); setFocus(""); setGeo("");
    setIntake(emptyIntake()); setIntel(null); setEmails(null);
    setError(null); setRetryCount(0); setEmailsLoading(false);
  };

  return (
    <div style={{ fontFamily:"Arial, sans-serif", minHeight:"100vh", background:C.soft }}>
      {screen==="orient"      && <OrientScreen orgName={orgName} setOrgName={setOrgName} budget={budget} setBudget={setBudget} focus={focus} setFocus={setFocus} geo={geo} setGeo={setGeo} canOrient={canOrient} onNext={researchOrg} error={error} />}
      {screen==="researching" && <ProgressScreen steps={RESEARCH_STEPS} stepIdx={stepIdx} orgName={orgName} title="Researching organization…" subtitle="Scanning CRA T3010, annual reports, and funder databases" />}
      {screen==="intake"      && <IntakeScreen intake={intake} setIntake={setIntake} onGenerate={()=>generate(false)} onReset={reset} error={error} debugLog={debugLog} />}
      {screen==="generating"  && <ProgressScreen steps={GEN_STEPS} stepIdx={stepIdx} orgName={intake.orgName} title="Building intelligence package…" subtitle="Applying Rule 11 tone and Rule 12 evidence standards" />}
      {screen==="review"      && intel && <ReviewScreen intel={intel} orgName={intake.orgName} emailsLoading={emailsLoading} emails={emails} onApprove={()=>setScreen("reveal")} onRetry={()=>generate(true)} onReset={reset} />}
      {screen==="reveal"      && intel && <RevealScreen intel={intel} intake={intake} emails={emails} emailsLoading={emailsLoading} onReset={reset} />}
    </div>
  );
}

// ── ORIENT ────────────────────────────────────────────────────────────────────
function OrientScreen({ orgName,setOrgName,budget,setBudget,focus,setFocus,geo,setGeo,canOrient,onNext,error }) {
  return (
    <div style={{ maxWidth:620, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ textAlign:"center", marginBottom:36 }}>
        <div style={{ display:"inline-block", background:C.ink, borderRadius:12, padding:"14px 28px", marginBottom:16 }}>
          <div style={{ color:C.lav, fontSize:10, letterSpacing:2, textTransform:"uppercase", marginBottom:3 }}>Infinite Opportunity™</div>
          <div style={{ color:C.white, fontSize:20, fontWeight:"bold" }}>Live Intelligence</div>
        </div>
        <p style={{ color:C.muted, fontSize:13, margin:0 }}>Enter the organization's name and we'll research the rest.</p>
      </div>
      <div style={{ marginBottom:24 }}>
        <label style={lbl}>Organization name</label>
        <input value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="e.g. Women's Centre of Calgary"
          style={{ width:"100%", padding:"13px 14px", fontSize:17, border:`2px solid ${orgName.trim().length>=3?C.pur:C.border}`, borderRadius:8, outline:"none", boxSizing:"border-box", color:C.charcoal, background:C.white }}
          autoFocus />
      </div>
      <div style={{ display:"grid", gap:18, marginBottom:28 }}>
        <div>
          <label style={lbl}>Annual operating budget <span style={{ color:C.muted, fontWeight:"normal" }}>(orients the research)</span></label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>{BUDGET_OPTIONS.map(b=><Chip key={b} label={b} selected={budget===b} onClick={()=>setBudget(b)} />)}</div>
        </div>
        <div>
          <label style={lbl}>Primary focus area</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>{FOCUS_OPTIONS.map(f=><Chip key={f} label={f} selected={focus===f} onClick={()=>setFocus(f)} />)}</div>
        </div>
        <div>
          <label style={lbl}>Geographic reach</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>{GEO_OPTIONS.map(g=><Chip key={g} label={g} selected={geo===g} onClick={()=>setGeo(g)} />)}</div>
        </div>
      </div>
      {error && <ErrBox msg={error} />}
      <button onClick={onNext} disabled={!canOrient} style={{ width:"100%", padding:"15px", background:canOrient?C.ink:"#CCC", color:C.white, border:"none", borderRadius:10, fontSize:15, fontWeight:"bold", cursor:canOrient?"pointer":"not-allowed" }}>
        Research Organization →
      </button>
      <p style={{ textAlign:"center", color:C.muted, fontSize:11, marginTop:10 }}>Scans CRA T3010, annual reports, and funder databases · ~30 seconds</p>
    </div>
  );
}

// ── INTAKE ────────────────────────────────────────────────────────────────────
function IntakeScreen({ intake, setIntake, onGenerate, onReset, error, debugLog }) {
  const set = (k,v) => setIntake(prev=>({...prev,[k]:v}));
  const conf = intake._confidence||"Medium";
  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"32px 20px" }}>
      <div style={{ background:C.ink, borderRadius:12, padding:"20px 24px", marginBottom:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ color:C.lav, fontSize:10, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Infinite Opportunity™ · Research Profile</div>
            <div style={{ color:C.white, fontSize:20, fontWeight:"bold" }}>{intake.orgName}</div>
            {intake.location && <div style={{ color:C.mid, fontSize:12, marginTop:2 }}>{intake.location} · {intake.sector}</div>}
          </div>
          <div style={{ background:conf==="High"?C.grnBg:conf==="Medium"?C.ambBg:C.pale, border:`1px solid ${conf==="High"?C.grnBorder:conf==="Medium"?"#E0C060":C.border}`, borderRadius:8, padding:"6px 12px", fontSize:11, color:conf==="High"?C.grn:conf==="Medium"?C.amb:C.muted, fontWeight:"bold" }}>
            {conf} Research Confidence
          </div>
        </div>
      </div>
      <div style={{ background:C.pale, border:`1px solid ${C.lav}`, borderRadius:8, padding:"10px 14px", marginBottom:18, display:"flex", gap:10 }}>
        <span style={{ fontSize:15, flexShrink:0 }}>✦</span>
        <p style={{ margin:0, color:C.pur, fontSize:12, lineHeight:1.5 }}>Built from public sources — CRA T3010, annual reports, and their website. Review and adjust before generating.</p>
      </div>
      <div style={{ display:"grid", gap:13, marginBottom:18 }}>
        <FR label="Mission" value={intake.mission} onChange={v=>set("mission",v)} rows={3} />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <FR label="Organization type" value={intake.orgType} onChange={v=>set("orgType",v)} />
          <FR label="Annual budget" value={intake.annualBudget} onChange={v=>set("annualBudget",v)} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <FR label="Geography" value={intake.geography} onChange={v=>set("geography",v)} />
          <FR label="Location (City, Province)" value={intake.location} onChange={v=>set("location",v)} />
        </div>
        <FR label="Who they serve" value={intake.audience} onChange={v=>set("audience",v)} />
        <FR label="What decisions the audience influences" value={intake.influence} onChange={v=>set("influence",v)} />
        <FR label="Current funders and sponsors" value={intake.currentFunding} onChange={v=>set("currentFunding",v)} rows={3} note="From CRA T3010, annual reports, website" />
        <FR label="Funding gaps (inferred)" value={intake.gaps} onChange={v=>set("gaps",v)} rows={2} note="Adjust based on your knowledge" />
      </div>
      {error && <ErrBox msg={error} />}

      {/* Debug panel — remove once research is confirmed working */}
      {debugLog && debugLog.length > 0 && (
        <div style={{ background:"#1A1A2E", borderRadius:8, padding:"12px 14px", marginBottom:14, fontFamily:"monospace" }}>
          <div style={{ color:"#A0A0C0", fontSize:10, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Debug — Research API Response</div>
          {debugLog.map((line, i) => (
            <div key={i} style={{ color: line.includes("YES") ? "#4AE080" : line.includes("NO") || line.includes("error") || line.includes("Exception") ? "#FF6B6B" : "#C0C0E0", fontSize:11, lineHeight:1.6 }}>{line}</div>
          ))}
        </div>
      )}

      <div style={{ display:"flex", gap:10 }}>
        <button onClick={onGenerate} style={{ flex:3, padding:"14px", background:C.ink, color:C.white, border:"none", borderRadius:10, fontSize:15, fontWeight:"bold", cursor:"pointer" }}>Generate Intelligence Package →</button>
        <button onClick={onReset} style={{ flex:1, padding:"14px", background:"transparent", color:C.muted, border:`1px solid ${C.border}`, borderRadius:10, fontSize:13, cursor:"pointer" }}>← Start Over</button>
      </div>
      <p style={{ textAlign:"center", color:C.muted, fontSize:11, marginTop:10 }}>Typically 60–90 seconds · You review before they see it</p>
    </div>
  );
}

// ── PROGRESS ──────────────────────────────────────────────────────────────────
function ProgressScreen({ steps, stepIdx, orgName, title, subtitle }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.ink }}>
      <div style={{ textAlign:"center", padding:40, maxWidth:460 }}>
        <div style={{ position:"relative", width:72, height:72, margin:"0 auto 28px" }}>
          <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:`4px solid ${C.lav}30`, borderTop:`4px solid ${C.lav}`, animation:"spin 1.2s linear infinite" }} />
          <div style={{ position:"absolute", inset:"14px", background:C.pur, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:C.white }}>∞</div>
        </div>
        <div style={{ color:C.lav, fontSize:10, letterSpacing:2, textTransform:"uppercase", marginBottom:6 }}>Infinite Opportunity™</div>
        <div style={{ color:C.white, fontSize:18, fontWeight:"bold", marginBottom:4 }}>{orgName}</div>
        <div style={{ color:C.mid, fontSize:13, marginBottom:4 }}>{title}</div>
        <div style={{ color:`${C.mid}99`, fontSize:11, marginBottom:28 }}>{subtitle}</div>
        <div style={{ background:`${C.white}10`, borderRadius:10, padding:"16px 20px" }}>
          {steps.map((s,i) => (
            <div key={s} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:i<steps.length-1?9:0, opacity:i>stepIdx?0.25:1, transition:"opacity 0.4s" }}>
              <div style={{ width:16, height:16, borderRadius:"50%", flexShrink:0, background:i<stepIdx?C.grn:i===stepIdx?C.lav:`${C.white}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:C.white }}>{i<stepIdx?"✓":""}</div>
              <span style={{ color:i<stepIdx?C.mid:i===stepIdx?C.white:C.mid, fontSize:12 }}>{s}</span>
            </div>
          ))}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

// ── REVIEW ────────────────────────────────────────────────────────────────────
function ReviewScreen({ intel, orgName, emailsLoading, emails, onApprove, onRetry, onReset }) {
  const high = (intel.targets||[]).filter(t=>t.priority==="HIGH");
  const all  = intel.targets||[];
  return (
    <div style={{ maxWidth:740, margin:"0 auto", padding:"28px 20px" }}>
      <div style={{ background:C.ambBg, border:`1px solid #E0C060`, borderRadius:10, padding:"12px 16px", marginBottom:18, display:"flex", gap:10, alignItems:"center" }}>
        <span style={{ fontSize:18 }}>👁</span>
        <div>
          <div style={{ color:C.amb, fontSize:13, fontWeight:"bold" }}>Your review — client cannot see this yet</div>
          <div style={{ color:"#9B7A00", fontSize:11 }}>Confirm this looks strong before flipping the iPad</div>
        </div>
        {/* Email status badge */}
        <div style={{ marginLeft:"auto", flexShrink:0 }}>
          {emailsLoading && <span style={{ fontSize:11, color:C.amb, background:"#FFF0C0", padding:"3px 10px", borderRadius:8 }}>✉ Drafting emails…</span>}
          {!emailsLoading && emails && <span style={{ fontSize:11, color:C.grn, background:C.grnBg, padding:"3px 10px", borderRadius:8 }}>✉ {emails.length} emails ready</span>}
        </div>
      </div>

      <div style={{ background:C.ink, borderRadius:12, padding:"20px 24px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ color:C.lav, fontSize:10, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Infinite Opportunity™</div>
          <div style={{ color:C.white, fontSize:20, fontWeight:"bold" }}>{orgName}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ color:C.mid, fontSize:10 }}>Opportunity Range</div>
          <div style={{ color:C.lav, fontSize:24, fontWeight:"bold" }}>{intel.opportunityRange}</div>
        </div>
      </div>

      <div style={{ background:C.white, borderRadius:10, padding:"16px 18px", marginBottom:12, border:`1px solid ${C.border}` }}>
        <div style={{ color:C.pur, fontSize:10, fontWeight:"bold", letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Strategic Summary</div>
        <p style={{ margin:0, color:C.charcoal, fontSize:13, lineHeight:1.6 }}>{intel.summary}</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
        {[{label:"Total Targets",value:all.length},{label:"HIGH Priority",value:high.length},{label:"Actions",value:(intel.actions||[]).length}].map(s=>(
          <div key={s.label} style={{ background:C.white, borderRadius:8, padding:"12px", border:`1px solid ${C.border}`, textAlign:"center" }}>
            <div style={{ color:C.ink, fontSize:26, fontWeight:"bold" }}>{s.value}</div>
            <div style={{ color:C.muted, fontSize:10 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background:C.white, borderRadius:10, border:`1px solid ${C.border}`, marginBottom:16, overflow:"hidden" }}>
        <div style={{ background:C.pale, padding:"8px 14px", borderBottom:`1px solid ${C.border}` }}>
          <span style={{ color:C.ink, fontSize:11, fontWeight:"bold" }}>Target Preview</span>
        </div>
        {all.slice(0,7).map((t,i)=>(
          <div key={i} style={{ padding:"9px 14px", borderBottom:i<Math.min(6,all.length-1)?`1px solid ${C.border}`:"none", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
            <div style={{ flex:1 }}>
              <span style={{ color:C.charcoal, fontSize:12, fontWeight:"bold" }}>{t.name}</span>
              <span style={{ color:C.muted, fontSize:11, marginLeft:6 }}>{t.category}</span>
            </div>
            <div style={{ display:"flex", gap:5, flexShrink:0 }}>
              <span style={{ fontSize:10, padding:"2px 7px", borderRadius:8, fontWeight:"bold", background:t.priority==="HIGH"?C.grnBg:C.pale, color:t.priority==="HIGH"?C.grn:C.pur }}>{t.priority}</span>
              <span style={{ color:C.pur, fontSize:11 }}>{t.range}</span>
            </div>
          </div>
        ))}
        {all.length>7 && <div style={{ padding:"7px 14px", color:C.muted, fontSize:11 }}>+ {all.length-7} more targets</div>}
      </div>

      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <button onClick={onApprove} style={{ flex:2, padding:"13px", background:C.ink, color:C.white, border:"none", borderRadius:10, fontSize:14, fontWeight:"bold", cursor:"pointer" }}>✓ Looks good — Show client</button>
        <button onClick={onRetry}   style={{ flex:1, padding:"13px", background:C.pale, color:C.ink, border:`1px solid ${C.border}`, borderRadius:10, fontSize:13, cursor:"pointer" }}>↺ Retry</button>
        <button onClick={onReset}   style={{ flex:1, padding:"13px", background:"transparent", color:C.muted, border:`1px solid ${C.border}`, borderRadius:10, fontSize:13, cursor:"pointer" }}>← New Org</button>
      </div>
    </div>
  );
}

// ── REVEAL ────────────────────────────────────────────────────────────────────
function RevealScreen({ intel, intake, emails, emailsLoading, onReset }) {
  const high    = (intel.targets||[]).filter(t=>t.priority==="HIGH");
  const monitor = (intel.targets||[]).filter(t=>t.priority!=="HIGH");
  const today   = new Date().toLocaleDateString("en-CA",{month:"long",year:"numeric"});
  const [activeTab, setActiveTab] = useState("intelligence");

  return (
    <div style={{ maxWidth:840, margin:"0 auto", padding:"28px 20px" }}>
      {/* Header */}
      <div style={{ background:C.ink, borderRadius:14, padding:"24px 28px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14 }}>
          <div>
            <div style={{ color:C.lav, fontSize:10, letterSpacing:2, textTransform:"uppercase", marginBottom:5 }}>Infinite Opportunity™ · Intelligence Snapshot</div>
            <div style={{ color:C.white, fontSize:24, fontWeight:"bold", marginBottom:3 }}>{intake.orgName}</div>
            <div style={{ color:C.mid, fontSize:12 }}>{intake.sector} · {intake.geography} · {today}</div>
          </div>
          <div style={{ background:C.pur, borderRadius:10, padding:"14px 20px", textAlign:"center" }}>
            <div style={{ color:C.lav, fontSize:10, marginBottom:3 }}>Opportunity Range</div>
            <div style={{ color:C.white, fontSize:24, fontWeight:"bold" }}>{intel.opportunityRange}</div>
            <div style={{ color:C.mid, fontSize:10, marginTop:2 }}>{(intel.targets||[]).length} targets identified</div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:4, marginBottom:20, background:C.pale, borderRadius:10, padding:4 }}>
        {[
          { id:"intelligence", label:"Intelligence" },
          { id:"emails", label: emailsLoading ? "✉ Drafting emails…" : `✉ Outreach Emails${emails?.length ? ` (${emails.length})` : ""}` },
        ].map(tab => (
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{
            flex:1, padding:"9px 12px", borderRadius:8, border:"none", fontSize:13, fontWeight:activeTab===tab.id?"bold":"normal",
            background:activeTab===tab.id?C.white:"transparent",
            color:activeTab===tab.id?C.ink:C.muted,
            cursor:"pointer", transition:"all 0.15s",
            boxShadow:activeTab===tab.id?"0 1px 4px rgba(45,16,96,0.10)":"none",
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "intelligence" && (
        <>
          {/* Summary */}
          <div style={{ background:C.white, borderRadius:12, padding:"20px 22px", marginBottom:16, border:`1px solid ${C.border}`, boxShadow:"0 2px 8px rgba(45,16,96,0.06)" }}>
            <div style={{ color:C.pur, fontSize:10, fontWeight:"bold", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Strategic Overview</div>
            <p style={{ margin:0, color:C.charcoal, fontSize:14, lineHeight:1.7 }}>{intel.summary}</p>
          </div>

          {/* HIGH */}
          {high.length>0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ background:C.grn, display:"inline-block", borderRadius:6, padding:"3px 10px", marginBottom:10 }}>
                <span style={{ color:C.white, fontSize:10, fontWeight:"bold" }}>HIGH PRIORITY · {high.length} TARGETS</span>
              </div>
              <div style={{ display:"grid", gap:8 }}>{high.map((t,i)=><TargetCard key={i} t={t} isHigh />)}</div>
            </div>
          )}

          {/* MONITOR */}
          {monitor.length>0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ background:C.pale, border:`1px solid ${C.border}`, display:"inline-block", borderRadius:6, padding:"3px 10px", marginBottom:10 }}>
                <span style={{ color:C.pur, fontSize:10, fontWeight:"bold" }}>BUILD TOWARD · {monitor.length} TARGETS</span>
              </div>
              <div style={{ display:"grid", gap:8 }}>{monitor.map((t,i)=><TargetCard key={i} t={t} isHigh={false} />)}</div>
            </div>
          )}

          {/* Observations */}
          {(intel.observations||[]).length>0 && (
            <div style={{ background:C.ink, borderRadius:12, padding:"20px 22px", marginBottom:16 }}>
              <div style={{ color:C.lav, fontSize:10, fontWeight:"bold", letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>Strategic Observations</div>
              {intel.observations.map((o,i)=>(
                <div key={i} style={{ display:"flex", gap:10, marginBottom:i<intel.observations.length-1?12:0 }}>
                  <div style={{ width:5, borderRadius:3, background:C.pur, flexShrink:0, minHeight:14 }} />
                  <p style={{ margin:0, color:C.mid, fontSize:13, lineHeight:1.6 }}>{o}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {(intel.actions||[]).length>0 && (
            <div style={{ background:C.white, borderRadius:12, padding:"20px 22px", marginBottom:16, border:`1px solid ${C.border}`, boxShadow:"0 2px 8px rgba(45,16,96,0.06)" }}>
              <div style={{ color:C.pur, fontSize:10, fontWeight:"bold", letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>Immediate Actions</div>
              {intel.actions.map((a,i)=>(
                <div key={i} style={{ display:"flex", gap:10, marginBottom:i<intel.actions.length-1?10:0, paddingBottom:i<intel.actions.length-1?10:0, borderBottom:i<intel.actions.length-1?`1px solid ${C.border}`:"none" }}>
                  <div style={{ width:20, height:20, borderRadius:"50%", background:C.pale, border:`1px solid ${C.lav}`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:C.pur, fontSize:10, fontWeight:"bold" }}>{i+1}</div>
                  <div>
                    <div style={{ color:C.charcoal, fontSize:13, marginBottom:2 }}>{a.action}</div>
                    <div style={{ color:C.muted, fontSize:11 }}>{[a.target,a.timeline,a.owner].filter(Boolean).join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "emails" && (
        <div>
          {emailsLoading && (
            <div style={{ textAlign:"center", padding:"60px 20px" }}>
              <div style={{ fontSize:32, marginBottom:12 }}>✉</div>
              <div style={{ color:C.pur, fontSize:14, fontWeight:"bold" }}>Drafting outreach emails…</div>
              <div style={{ color:C.muted, fontSize:12, marginTop:6 }}>Writing peer-to-peer emails for your top HIGH priority targets</div>
            </div>
          )}
          {!emailsLoading && (!emails||emails.length===0) && (
            <div style={{ textAlign:"center", padding:"60px 20px", color:C.muted, fontSize:13 }}>
              No email drafts available. Retry generation to build emails.
            </div>
          )}
          {!emailsLoading && emails && emails.length>0 && (
            <div style={{ display:"grid", gap:14 }}>
              {emails.map((e,i) => <EmailCard key={i} email={e} index={i} />)}
              <div style={{ background:C.pale, borderRadius:10, padding:"14px 16px", border:`1px solid ${C.lav}` }}>
                <p style={{ margin:0, color:C.pur, fontSize:12, lineHeight:1.5 }}>
                  <strong>These are opening drafts.</strong> Personalize the subject line and any relationship context before sending. The full workbook includes 15–20 email drafts across all targets.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ background:C.ink, borderRadius:10, padding:"12px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8, marginTop:20 }}>
        <span style={{ color:C.mid, fontSize:11 }}>The Infinite CDO Advisory · theinfinitecdo.com · Confidential · {today}</span>
        <button onClick={onReset} style={{ background:"transparent", border:`1px solid ${C.lav}40`, color:C.lav, borderRadius:6, padding:"5px 12px", fontSize:11, cursor:"pointer" }}>← New Organization</button>
      </div>
    </div>
  );
}

// ── EMAIL CARD ────────────────────────────────────────────────────────────────
function EmailCard({ email, index }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ background:C.white, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden", boxShadow:"0 2px 8px rgba(45,16,96,0.06)" }}>
      {/* Card header */}
      <div style={{ background:C.ink, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ color:C.lav, fontSize:10, letterSpacing:1, textTransform:"uppercase", marginBottom:2 }}>Draft {index+1} · Outreach</div>
          <div style={{ color:C.white, fontSize:14, fontWeight:"bold" }}>To: {email.to}</div>
        </div>
        <button onClick={copy} style={{ background:copied?C.grnBg:C.pur, color:copied?C.grn:C.white, border:"none", borderRadius:7, padding:"6px 14px", fontSize:12, cursor:"pointer", fontWeight:"bold", transition:"all 0.2s" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      {/* Subject */}
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`, background:C.pale }}>
        <span style={{ color:C.muted, fontSize:11 }}>Subject: </span>
        <span style={{ color:C.charcoal, fontSize:13, fontWeight:"bold" }}>{email.subject}</span>
      </div>
      {/* Body */}
      <div style={{ padding:"14px 16px" }}>
        <pre style={{ margin:0, color:C.charcoal, fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:"Arial, sans-serif" }}>{email.body}</pre>
      </div>
    </div>
  );
}

// ── TARGET CARD ───────────────────────────────────────────────────────────────
function TargetCard({ t, isHigh }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background:C.white, borderRadius:10, border:`1px solid ${isHigh?C.grnBorder:C.border}`, boxShadow:"0 1px 5px rgba(45,16,96,0.05)", overflow:"hidden" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ padding:"11px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, justifyContent:"space-between" }}>
        <div style={{ flex:1 }}>
          <div style={{ color:C.charcoal, fontSize:13, fontWeight:"bold" }}>{t.name}</div>
          <div style={{ color:C.muted, fontSize:11, marginTop:1 }}>{t.category} · {t.reachability}</div>
        </div>
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          <span style={{ color:C.pur, fontSize:12, fontWeight:"bold" }}>{t.range}</span>
          <span style={{ fontSize:10, padding:"2px 7px", borderRadius:8, fontWeight:"bold", background:t.confidence==="High"?C.grnBg:t.confidence==="Medium"?C.ambBg:C.pale, color:t.confidence==="High"?C.grn:t.confidence==="Medium"?C.amb:C.muted }}>{t.confidence}</span>
          <span style={{ color:C.muted, fontSize:12 }}>{open?"▲":"▼"}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding:"0 14px 12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ marginTop:10, display:"grid", gap:9 }}>
            {t.why      && <DR label="Why now"  value={t.why} />}
            {t.signal   && <DR label="Signal"   value={t.signal} />}
            {t.action   && <DR label="Action"   value={t.action} />}
            {t.validate && <DR label="Validate" value={t.validate} />}
            {t.contact  && <DR label="Contact"  value={`${t.contact}${t.contactStatus?` (${t.contactStatus})`:""}`} />}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:2 }}>
              {t.signalClass && <Tag label={t.signalClass} />}
              {t.horizon     && <Tag label={t.horizon} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared small components ───────────────────────────────────────────────────
function DR({ label, value }) {
  return (
    <div>
      <div style={{ color:C.pur, fontSize:9, fontWeight:"bold", letterSpacing:1, textTransform:"uppercase", marginBottom:2 }}>{label}</div>
      <div style={{ color:C.charcoal, fontSize:12, lineHeight:1.5 }}>{value}</div>
    </div>
  );
}
function Tag({ label }) {
  return <span style={{ background:C.pale, color:C.pur, fontSize:10, padding:"2px 7px", borderRadius:6, border:`1px solid ${C.border}` }}>{label}</span>;
}
function FR({ label, value, onChange, rows, note }) {
  const s = { width:"100%", padding:"9px 11px", fontSize:13, border:`1px solid ${C.border}`, borderRadius:7, outline:"none", boxSizing:"border-box", color:C.charcoal, background:C.white, fontFamily:"Arial, sans-serif" };
  return (
    <div>
      <label style={{ display:"block", marginBottom:4, color:C.charcoal, fontSize:12, fontWeight:"bold" }}>
        {label}{note && <span style={{ color:C.muted, fontWeight:"normal" }}> · {note}</span>}
      </label>
      {rows ? <textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows} style={{ ...s, resize:"vertical" }} /> : <input value={value} onChange={e=>onChange(e.target.value)} style={s} />}
    </div>
  );
}
function Chip({ label, selected, onClick }) {
  return <button onClick={onClick} style={{ padding:"5px 12px", borderRadius:18, fontSize:12, cursor:"pointer", border:`1.5px solid ${selected?C.pur:C.border}`, background:selected?C.ink:C.white, color:selected?C.white:C.charcoal, fontWeight:selected?"bold":"normal", fontFamily:"Arial, sans-serif" }}>{label}</button>;
}
function ErrBox({ msg }) {
  return <div style={{ background:"#FFF0F0", border:"1px solid #FFAAAA", borderRadius:8, padding:"10px 14px", marginBottom:14, color:"#991111", fontSize:12 }}>{msg}</div>;
}
const lbl = { display:"block", marginBottom:6, color:C.charcoal, fontSize:12, fontWeight:"bold" };
