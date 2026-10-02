/* GhostDevol Detonation Risk Calculator
 * Calculates detonation risk based on boost, timing, octane, and compression.
 * Outputs WARNING levels, not blockers — the tuner decides, but they're informed.
 *
 * Theory:
 * - Cylinder pressure increases with boost and compression
 * - Higher octane resists detonation (higher auto-ignition temp)
 * - More timing advance increases peak pressure/temperature
 * - Detonation occurs when end-gas auto-ignites before flame front arrives
 */

function calculateDetonationRisk(params) {
  const {
    boostPsi = 0,           // Boost pressure in PSI (0 = N/A)
    timingAdvance = 0,       // Total timing advance in degrees BTDC
    octane = 93,            // Fuel octane (87, 89, 91, 93, 100, 110, E85=105)
    compressionRatio = 10.3, // Static compression ratio (VQ35DE stock = 10.3:1)
    intakeTempF = 100,      // Intake air temp in Fahrenheit
    afr = 12.5,             // Air-fuel ratio under load
  } = params;

  // ============================================================
  // STEP 1: Calculate effective compression (boost + static)
  // ============================================================
  // Effective CR = Static CR * (1 + boost/14.7)
  const pressureRatio = 1 + (boostPsi / 14.7);
  const effectiveCR = compressionRatio * pressureRatio;

  // ============================================================
  // STEP 2: Calculate octane requirement
  // ============================================================
  // Empirical formula calibrated to real engines:
  // - VQ35DE (10.3:1, 20° timing, 0 boost) needs ~87 octane (runs safe on 91)
  // - Each PSI of boost adds ~1.2 octane requirement
  // - Higher compression multiplies boost effect
  
  const baseOctane = 65 + (compressionRatio * 1.8) + (timingAdvance * 0.2);
  const boostOctaneDemand = boostPsi * 1.2 * (compressionRatio / 10.0);
  const tempOctaneDemand = Math.max(0, (intakeTempF - 80) * 0.08);
  
  const requiredOctane = baseOctane + boostOctaneDemand + tempOctaneDemand;

  // ============================================================
  // STEP 3: Calculate octane margin
  // ============================================================
  // Positive = safe, negative = dangerous
  const octaneMargin = octane - requiredOctane;

  // ============================================================
  // STEP 4: Calculate cylinder pressure index
  // ============================================================
  // Higher = more detonation risk
  const pressureIndex = effectiveCR * (1 + timingAdvance / 50);

  // ============================================================
  // STEP 5: Determine risk level
  // ============================================================
  let riskLevel, riskColor, riskDescription, recommendations = [];

  if (octaneMargin >= 5) {
    riskLevel = 'SAFE';
    riskColor = 'green';
    riskDescription = 'Octane margin is comfortable. Detonation unlikely under normal conditions.';
  } else if (octaneMargin >= 0) {
    riskLevel = 'CAUTION';
    riskColor = 'yellow';
    riskDescription = 'Octane margin is thin. Monitor for knock under high load / high temp.';
    recommendations.push('Consider reducing timing by 1-2° for safety margin');
    recommendations.push('Ensure intercooler is effective (IAT < 120°F)');
  } else if (octaneMargin >= -5) {
    riskLevel = 'WARNING';
    riskColor = 'orange';
    riskDescription = 'Octane deficit detected. Detonation likely under sustained load.';
    recommendations.push('REDUCE timing by ' + Math.ceil(Math.abs(octaneMargin) / 0.6) + '° immediately');
    recommendations.push('Use higher octane fuel or reduce boost by ' + Math.ceil(Math.abs(octaneMargin) / 2) + ' PSI');
    recommendations.push('Enrich fuel mixture to 11.0-11.5 AFR under boost');
  } else if (octaneMargin >= -10) {
    riskLevel = 'DANGEROUS';
    riskColor = 'red';
    riskDescription = 'Severe octane deficit. Detonation WILL occur. Engine damage imminent.';
    recommendations.push('DO NOT run this calibration');
    recommendations.push('Reduce timing by ' + Math.ceil(Math.abs(octaneMargin) / 0.6) + '° minimum');
    recommendations.push('Reduce boost by ' + Math.ceil(Math.abs(octaneMargin) / 1.5) + ' PSI minimum');
    recommendations.push('Switch to E85 or race gas (100+ octane)');
  } else {
    riskLevel = 'CATASTROPHIC';
    riskColor = 'darkred';
    riskDescription = 'Catastrophic detonation guaranteed. Piston/ring/rod failure will occur within minutes.';
    recommendations.push('DO NOT START ENGINE with this calibration');
    recommendations.push('This combination will destroy the motor');
    recommendations.push('Required octane: ' + Math.ceil(requiredOctane) + ' (you have: ' + octane + ')');
  }

  // ============================================================
  // STEP 6: Additional risk factors
  // ============================================================
  const riskFactors = [];
  
  if (boostPsi > 15 && compressionRatio > 9.5) {
    riskFactors.push('High boost + high compression = extreme cylinder pressure');
  }
  if (timingAdvance > 25 && boostPsi > 10) {
    riskFactors.push('Aggressive timing under boost — high risk');
  }
  if (intakeTempF > 140) {
    riskFactors.push('High intake temp (' + intakeTempF + '°F) significantly increases detonation risk');
  }
  if (afr > 12.0 && boostPsi > 5) {
    riskFactors.push('Lean AFR (' + afr + ') under boost — enrich to 11.0-11.5');
  }
  if (octane < 91 && boostPsi > 0) {
    riskFactors.push('Pump gas (87-89) with boost is extremely risky');
  }

  return {
    riskLevel,
    riskColor,
    riskDescription,
    recommendations,
    riskFactors,
    calculations: {
      effectiveCompressionRatio: effectiveCR.toFixed(2),
      pressureRatio: pressureRatio.toFixed(2),
      requiredOctane: requiredOctane.toFixed(1),
      octaneMargin: octaneMargin.toFixed(1),
      pressureIndex: pressureIndex.toFixed(1),
    },
    inputs: { boostPsi, timingAdvance, octane, compressionRatio, intakeTempF, afr }
  };
}

// Example: VQ35DE with 12 PSI, 93 octane, stock compression
// calculateDetonationRisk({ boostPsi: 12, timingAdvance: 15, octane: 93, compressionRatio: 10.3 });

if (typeof module !== 'undefined') module.exports = { calculateDetonationRisk };
