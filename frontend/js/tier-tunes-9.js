// GhostTech 9-Tune Preset System — 3 Tiers × 3 Stages
// Each tune includes detailed hardware requirements as warnings (not blockers)

var TIER_TUNES = {
  // ============================================================
  // TIER 1 — NATURALLY ASPIRATED / BOLT-ONS
  // ============================================================
  "t1s1": {
    id: "t1s1", tier: 1, stage: 1,
    name: "Tier 1 Stage 1 — Street Bolt-ons",
    category: "NA / Bolt-ons",
    description: "Mild street tune for basic bolt-ons. Improved throttle response, slightly more aggressive timing, raised rev limiter. Safe on completely stock internals.",
    hardware: [
      "Cold air intake (recommended)",
      "Cat-back exhaust (recommended)",
      "Stock internals are fine",
      "93 octane fuel recommended, 91 minimum"
    ],
    warning: "Designed for stock or lightly modified VQ35DE. If you have no bolt-ons, gains will be minimal but the tune is safe.",
    params: { fuelTrim: 1.03, timingAdd: 2, revLimit: 7000, throttleAggr: 1.15, vtcAggr: 1.1 }
  },
  "t1s2": {
    id: "t1s2", tier: 1, stage: 2,
    name: "Tier 1 Stage 2 — Headers & Flow",
    category: "NA / Bolt-ons",
    description: "Aggressive NA tune for headers and high-flow exhaust. More timing advance, leaner cruise for efficiency, sharper VTC mapping. Expects improved breathing.",
    hardware: [
      "Long-tube or shorty headers (required for full benefit)",
      "High-flow cats or test pipes",
      "Cold air intake",
      "Cat-back exhaust",
      "93 octane fuel required"
    ],
    warning: "Expects headers and improved exhaust flow. On stock manifolds, the aggressive timing may cause knock — monitor with a scan tool.",
    params: { fuelTrim: 1.05, timingAdd: 4, revLimit: 7200, throttleAggr: 1.25, vtcAggr: 1.2 }
  },
  "t1s3": {
    id: "t1s3", tier: 1, stage: 3,
    name: "Tier 1 Stage 3 — Max NA",
    category: "NA / Bolt-ons",
    description: "Maximum naturally aspirated tune. Aggressive timing, high rev limit, full VTC optimization. Designed for cammed engines with full bolt-ons.",
    hardware: [
      "Aftermarket camshafts (strongly recommended)",
      "Long-tube headers (required)",
      "High-flow cats or test pipes",
      "Cold air intake + larger throttle body",
      "Full exhaust system",
      "93+ octane fuel required",
      "Upgraded valve springs if revving past 7500"
    ],
    warning: "This is an aggressive NA tune. Without cams and headers, you risk detonation. Valve float is a real concern above 7400 RPM on stock springs.",
    params: { fuelTrim: 1.07, timingAdd: 6, revLimit: 7500, throttleAggr: 1.35, vtcAggr: 1.3 }
  },

  // ============================================================
  // TIER 2 — FORCED INDUCTION (STOCK INTERNALS)
  // ============================================================
  "t2s1": {
    id: "t2s1", tier: 2, stage: 1,
    name: "Tier 2 Stage 1 — Low Boost",
    category: "Turbo / Supercharged",
    description: "Conservative forced induction tune for 6-8 PSI. Rich fuel under boost, retarded timing, safe for stock internals. Great daily driver boost setup.",
    hardware: [
      "Turbocharger or supercharger kit installed",
      "Front-mount intercooler (required)",
      "Upgraded fuel pump (Walbro 255 or equivalent)",
      "Larger injectors (440cc+ recommended)",
      "Boost gauge (required for monitoring)",
      "93 octane fuel required",
      "Stock internals OK up to 8 PSI"
    ],
    warning: "Do NOT exceed 8 PSI on stock internals with this tune. The VQ35DE rods are the weak point. Monitor AFR — should be 11.5:1 or richer under full boost.",
    params: { fuelTrim: 1.18, timingAdd: -4, revLimit: 6800, boostTarget: 7, throttleAggr: 1.2, vtcAggr: 1.0 }
  },
  "t2s2": {
    id: "t2s2", tier: 2, stage: 2,
    name: "Tier 2 Stage 2 — Medium Boost",
    category: "Turbo / Supercharged",
    description: "Aggressive street boost tune for 10-14 PSI. Pushing the limits of stock internals. Requires excellent fuel system and cooling.",
    hardware: [
      "Turbo/supercharger kit with intercooler",
      "Upgraded fuel pump (Walbro 450 or dual pump)",
      "750cc+ injectors (required)",
      "Upgraded clutch (stock will slip)",
      "Oil cooler (strongly recommended)",
      "Boost + wideband AFR gauges (required)",
      "93+ octane or E85 blend",
      "Head studs recommended above 12 PSI"
    ],
    warning: "You are at the limit of stock VQ35DE rods (around 400-450whp). Detonation at this level WILL break ring lands. This tune assumes your fuel system can keep up — if AFR goes lean under boost, lift immediately.",
    params: { fuelTrim: 1.28, timingAdd: -6, revLimit: 7000, boostTarget: 12, throttleAggr: 1.3, vtcAggr: 1.0 }
  },
  "t2s3": {
    id: "t2s3", tier: 2, stage: 3,
    name: "Tier 2 Stage 3 — High Boost (Stock Block Limit)",
    category: "Turbo / Supercharged",
    description: "Maximum safe boost on stock internals — 15-18 PSI. This is the ragged edge. Every supporting mod must be in place. Not for the faint of heart.",
    hardware: [
      "Built fuel system (dual pumps, -8AN lines)",
      "1000cc+ injectors",
      "Head studs (ARP L19 or 625+)",
      "MLS head gaskets",
      "Upgraded clutch (twin disc recommended)",
      "Large front-mount intercooler",
      "Oil cooler + upgraded radiator",
      "E85 fuel strongly recommended",
      "Forged pistons recommended (you're on borrowed time without them)"
    ],
    warning: "CRITICAL: Stock VQ rods fail around 500whp. This tune can exceed that. You MUST have a wideband and boost gauge. Any knock at this level can window the block. Consider this a 'send it' tune — have a spare engine fund.",
    params: { fuelTrim: 1.38, timingAdd: -8, revLimit: 7200, boostTarget: 16, throttleAggr: 1.4, vtcAggr: 1.0 }
  },

  // ============================================================
  // TIER 3 — BUILT MOTOR
  // ============================================================
  "t3s1": {
    id: "t3s1", tier: 3, stage: 1,
    name: "Tier 3 Stage 1 — Forged Street",
    category: "Built Motor",
    description: "Tune for forged internals with moderate boost. Safe, reliable power for a built street car. Conservative enough for daily driving.",
    hardware: [
      "Forged pistons (low compression, 8.5:1 - 9.0:1)",
      "Forged H-beam or I-beam rods",
      "ACL or King bearings",
      "ARP main + head studs",
      "Turbo/supercharger kit",
      "1000cc+ injectors",
      "Dual fuel pumps",
      "93 octane or E85"
    ],
    warning: "Assumes a properly built bottom end with correct clearances. If your builder didn't set it up for boost, don't use this tune. Break-in period must be complete (500+ miles).",
    params: { fuelTrim: 1.30, timingAdd: -5, revLimit: 7500, boostTarget: 14, throttleAggr: 1.35, vtcAggr: 1.1 }
  },
  "t3s2": {
    id: "t3s2", tier: 3, stage: 2,
    name: "Tier 3 Stage 2 — Race Build",
    category: "Built Motor",
    description: "Aggressive race-oriented tune for fully built engines. High boost, aggressive timing, high rev limit. For track and strip use.",
    hardware: [
      "Fully forged rotating assembly",
      "Ported heads + oversized valves",
      "Aftermarket camshafts (boost-specific grind)",
      "Sheet metal or high-flow intake manifold",
      "Large turbo(s) or high-boost supercharger",
      "1600cc+ injectors",
      "Standalone-worthy fuel system",
      "E85 fuel required",
      "Built transmission + rear end",
      "Roll cage (you'll need it at this power)"
    ],
    warning: "This is a race tune. Not for street use. Requires E85 and a fully built drivetrain. Power levels will break stock transmissions, differentials, and axles. Dyno tuning recommended to dial in for your specific setup.",
    params: { fuelTrim: 1.45, timingAdd: -3, revLimit: 8000, boostTarget: 22, throttleAggr: 1.5, vtcAggr: 1.2 }
  },
  "t3s3": {
    id: "t3s3", tier: 3, stage: 3,
    name: "Tier 3 Stage 3 — Max Effort",
    category: "Built Motor",
    description: "All-out maximum effort tune. Everything turned up. This is for dedicated race cars with no compromises. If you have to ask, you're not ready.",
    hardware: [
      "Billet crank, forged everything",
      "Stage 3+ ported heads",
      "Custom camshafts",
      "Large frame turbo(s)",
      "2000cc+ injectors or mechanical injection",
      "Dry sump oiling",
      "E98 or race fuel (C16/Q16)",
      "Full tube chassis or back-half car",
      "Parachute (seriously)"
    ],
    warning: "EXTREME: This tune assumes a professional race build. Power output can exceed 1000whp. You need a professional tuner on a dyno to finalize this — this preset is a starting point, not a finished tune. Engine damage is likely without proper dyno validation.",
    params: { fuelTrim: 1.55, timingAdd: -2, revLimit: 8500, boostTarget: 30, throttleAggr: 1.6, vtcAggr: 1.3 }
  }
};

// Helper: get tunes by tier
function getTunesByTier(tier) {
  return Object.values(TIER_TUNES).filter(function(t) { return t.tier === tier; });
}

// Helper: get all tunes sorted by tier then stage
function getAllTunesSorted() {
  return Object.values(TIER_TUNES).sort(function(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.stage - b.stage;
  });
}
