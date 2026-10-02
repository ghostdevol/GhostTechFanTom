/* GhostDevol Smart Tune Sliders
 * Chained adjustments: moving one slider updates all related tables together.
 * Safe ranges prevent dangerous combinations. Detonation warnings, not blockers.
 *
 * Example: Reducing fuel also leans the target AFR and adjusts MAF scaling
 * in the same region — because they're physically linked.
 */

// ============================================================
// SLIDER DEFINITIONS
// Each slider controls a primary parameter and chains to related ones.
// ============================================================

const TUNE_SLIDERS = {
  fuel_trim: {
    name: 'Fuel Trim',
    description: 'Overall fueling adjustment. Chains to target AFR and MAF scaling.',
    unit: '%',
    min: -15,          // Max lean (safe limit)
    max: +25,          // Max rich (safe limit)
    step: 1,
    default: 0,
    // Chained adjustments: when fuel changes, these change proportionally
    chains: {
      target_lambda: { ratio: 0.5 },    // 50% of fuel change applies to lambda target
      maf_scaling: { ratio: 0.3 },       // 30% applies to MAF (air follows fuel)
    },
    // Safety: warn if going too lean under boost
    warnings: [
      { condition: (v, ctx) => v < -10 && ctx.boostPsi > 5, message: 'Lean under boost — detonation risk' },
      { condition: (v) => v < -15, message: 'Exceeds safe lean limit' },
    ]
  },

  timing_advance: {
    name: 'Timing Advance',
    description: 'Global timing adjustment. Chains to knock sensitivity. Monitored by detonation calculator.',
    unit: '°',
    min: -10,
    max: +6,
    step: 0.5,
    default: 0,
    chains: {
      knock_sensitivity: { ratio: 0.4 },  // More timing = more sensitive knock detection
    },
    warnings: [
      { condition: (v, ctx) => v > 3 && ctx.boostPsi > 8, message: 'Aggressive timing under boost' },
      { condition: (v, ctx) => v > 0 && ctx.octane < 91, message: 'Added timing on low octane' },
    ]
  },

  throttle_response: {
    name: 'Throttle Response',
    description: 'Throttle pedal sensitivity. Chains to torque request.',
    unit: '%',
    min: -20,
    max: +40,
    step: 5,
    default: 0,
    chains: {
      torque_request: { ratio: 0.8 },
    },
    warnings: []
  },

  cam_intake: {
    name: 'Intake Cam Advance',
    description: 'Intake cam timing. More advance = more mid-range, less top-end.',
    unit: '°',
    min: -10,
    max: +15,
    step: 1,
    default: 0,
    chains: {
      cam_exhaust: { ratio: -0.5 },       // Intake advance often pairs with exhaust retard
    },
    warnings: [
      { condition: (v) => v > 10, message: 'High cam advance may cause PTV clearance issues' },
    ]
  },

  boost_target: {
    name: 'Boost Target',
    description: 'Target boost pressure. Automatically pulls timing (1° per PSI).',
    unit: 'PSI',
    min: 0,
    max: 25,
    step: 1,
    default: 0,
    chains: {
      timing_advance: { ratio: -1.0 },    // -1° per PSI (Daniel's rule)
      fuel_trim: { ratio: 2.0 },           // +2% fuel per PSI (approximate)
    },
    warnings: [
      { condition: (v, ctx) => v > 15 && ctx.compressionRatio > 9.5, message: 'High boost on high compression — forged internals required' },
      { condition: (v) => v > 20, message: 'Extreme boost — race build only' },
    ]
  },

  rev_limit: {
    name: 'Rev Limit',
    description: 'Maximum RPM. Chains to soft limiter.',
    unit: 'RPM',
    min: 4000,
    max: 8000,
    step: 100,
    default: 6600,
    chains: {
      soft_limiter: { offset: -200 },      // Soft limiter 200 RPM below hard
    },
    warnings: [
      { condition: (v) => v > 7500, message: 'High RPM — valvetrain must be upgraded' },
    ]
  },

  idle_rpm: {
    name: 'Idle RPM',
    description: 'Target idle speed.',
    unit: 'RPM',
    min: 600,
    max: 1200,
    step: 50,
    default: 750,
    chains: {},
    warnings: []
  },
};

// ============================================================
// APPLY SLIDER WITH CHAINED ADJUSTMENTS
// ============================================================

function applySlider(tune, sliderId, value, context = {}) {
  const slider = TUNE_SLIDERS[sliderId];
  if (!slider) throw new Error('Unknown slider: ' + sliderId);

  // Clamp to safe range
  value = Math.max(slider.min, Math.min(slider.max, value));

  const changes = {};
  
  // Primary change
  changes[sliderId] = value;

  // Chained changes
  for (const [chainedId, chain] of Object.entries(slider.chains)) {
    if (chain.ratio !== undefined) {
      changes[chainedId] = value * chain.ratio;
    } else if (chain.offset !== undefined) {
      changes[chainedId] = value + chain.offset;
    }
  }

  // Check warnings
  const warnings = [];
  for (const w of slider.warnings) {
    if (w.condition(value, context)) {
      warnings.push(w.message);
    }
  }

  return { changes, warnings, sliderId, value };
}

// ============================================================
// GHOSTTECH READABLE FORMAT
// Human-readable tune export/import
// ============================================================

function exportGhostTech(tuneName, sliderValues, metadata = {}) {
  const lines = [];
  lines.push('='.repeat(60));
  lines.push('GHOSTTECH TUNE FILE');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push('[Tune]');
  lines.push(`Name = "${tuneName}"`);
  lines.push(`Created = "${new Date().toISOString()}"`);
  if (metadata.vehicle) lines.push(`Vehicle = "${metadata.vehicle}"`);
  lines.push(`ECU = "${metadata.ecu || 'SH7058'}"`);
  lines.push('');
  lines.push('[Sliders]');
  for (const [id, value] of Object.entries(sliderValues)) {
    const slider = TUNE_SLIDERS[id];
    if (slider) {
      lines.push(`${id} = ${value}  ; ${slider.name} (${slider.unit})`);
    }
  }
  lines.push('');
  lines.push('[Chained_Adjustments]');
  lines.push('; These were auto-applied based on slider positions');
  for (const [id, value] of Object.entries(sliderValues)) {
    const slider = TUNE_SLIDERS[id];
    if (slider && Object.keys(slider.chains).length > 0) {
      for (const [chainedId, chain] of Object.entries(slider.chains)) {
        const chainedValue = chain.ratio !== undefined 
          ? (value * chain.ratio).toFixed(2)
          : (value + chain.offset);
        lines.push(`; ${id} -> ${chainedId} = ${chainedValue}`);
      }
    }
  }
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('END GHOSTTECH TUNE');
  lines.push('='.repeat(60));
  return lines.join('\n');
}

function importGhostTech(text) {
  const result = { tuneName: '', sliderValues: {}, metadata: {} };
  const lines = text.split('\n');
  let section = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1);
      continue;
    }
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('=')) continue;
    
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove trailing comment
    const semiIdx = value.indexOf(';');
    if (semiIdx !== -1) value = value.slice(0, semiIdx).trim();
    // Remove quotes
    value = value.replace(/^"|"$/g, '');
    
    if (section === 'Tune') {
      if (key === 'Name') result.tuneName = value;
      else result.metadata[key.toLowerCase()] = value;
    } else if (section === 'Sliders') {
      const numVal = parseFloat(value);
      if (!isNaN(numVal)) result.sliderValues[key] = numVal;
    }
  }
  
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { TUNE_SLIDERS, applySlider, exportGhostTech, importGhostTech };
}
