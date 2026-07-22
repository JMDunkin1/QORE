export const WINTER_STORAGE_SEASON_START_MONTH = 9
export const WINTER_HEATING_DEMAND_BASE_F = 65
export const WINTER_MAX_EFFECTIVE_OVERLAY_CAP = 0.6

export const WINTER_PRODUCTION_SIGNAL_SOURCE_IDS = Object.freeze([
  'gfs',
  'gefs-mean',
  'graphcastgfs',
  'aigfs',
])

export const WINTER_PRODUCTION_HEATING_DEMAND_SOURCE_IDS = Object.freeze([
  ...WINTER_PRODUCTION_SIGNAL_SOURCE_IDS,
  'ecmwf-ifs',
  'ecmwf-aifs',
  'gem-global',
])

export const WINTER_GRADED_SHIFT_PARAMETERS = Object.freeze({
  sameDirectionBaseScale: 0.75,
  sameDirectionShiftDivisor: 8,
  sameDirectionMinimumScale: 0.75,
  sameDirectionMaximumScale: 1.25,
  adverseBaseScale: 0.9,
  adverseShiftDivisor: 10,
  adverseMinimumScale: 0.45,
  adverseMaximumScale: 0.9,
  neutralScale: 0.85,
  dropAdverseStandalone: true,
})

export const WINTER_HEATING_DEMAND_TIERS = Object.freeze({
  moderateAnomalyF: 8,
  strongAnomalyF: 12,
  subMinimumScale: 0.65,
  minimumScale: 1,
  moderateScale: 1.1,
  strongScale: 1.25,
})

const DEFAULT_STORAGE_POLICY = Object.freeze({ id: 'none', kind: 'none' })
const DEFAULT_RESOLUTION_POLICY = Object.freeze({ id: 'none', kind: 'none' })
const DEFAULT_HEATING_DEMAND_POLICY = Object.freeze({ id: 'none', kind: 'none' })

function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function rowPosition(row) {
  return numberFrom(row?.ungPosition ?? row?.position)
}

function sameDirection(firstPosition, secondPosition) {
  return firstPosition !== 0 && secondPosition !== 0 && Math.sign(firstPosition) === Math.sign(secondPosition)
}

export function isWinterFollowRow(row) {
  return row?.windowId === 'weather-follow'
}

export function isWinterReversionRow(row) {
  return row?.windowId === 'weather-reversion'
}

export function winterStorageSeasonStartFor(isoDate) {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  const seasonYear = month >= WINTER_STORAGE_SEASON_START_MONTH ? year : year - 1
  return `${seasonYear}-${String(WINTER_STORAGE_SEASON_START_MONTH).padStart(2, '0')}-01`
}

function blendPositionFor(policy, dualRow, weatherRow, volatilityPosition) {
  const followRow = isWinterFollowRow(dualRow) ? dualRow : null
  const reversionRow = isWinterReversionRow(weatherRow) ? weatherRow : null
  const followPosition = rowPosition(followRow)
  const reversionPosition = rowPosition(reversionRow)
  const volatilityConfirmsReversion = reversionRow
    && volatilityPosition !== 0
    && Math.sign(reversionPosition) === volatilityPosition

  if (policy.conflictPolicy === 'net-position') {
    return {
      followRow,
      reversionRow,
      followPosition,
      reversionPosition,
      position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
      blendLeg: followRow && reversionRow
        ? 'dual-follow+weather-hybrid-reversion'
        : followRow
          ? 'dual-follow'
          : reversionRow
            ? 'weather-hybrid-reversion'
            : 'index-fallback',
    }
  }

  if (policy.conflictPolicy === 'fade-confirmed-follow') {
    if (reversionRow && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
    if (reversionRow) {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (
    policy.conflictPolicy === 'confirmed-warm-short'
    || policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow'
  ) {
    if (
      followRow?.thesisKind === 'warm-short'
      && reversionRow?.thesisKind === 'reversion-short'
      && sameDirection(followPosition, reversionPosition)
    ) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-warm-short+weather-hybrid-reversion',
      }
    }
    if (policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow' && followRow?.thesisKind === 'cold-long') {
      return {
        followRow,
        reversionRow: null,
        followPosition,
        reversionPosition: 0,
        position: followPosition,
        blendLeg: 'dual-cold-follow',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-plus-cold-follow') {
    if (followRow?.thesisKind === 'cold-long') {
      const includeReversion = reversionRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = includeReversion ? reversionPosition : 0
      return {
        followRow,
        reversionRow: includeReversion ? reversionRow : null,
        followPosition,
        reversionPosition: scaledReversionPosition,
        position: clamp(followPosition + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeReversion ? 'confirmed-follow+weather-hybrid-reversion' : 'dual-cold-follow',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (includeFollow ? 1 : (policy.standaloneReversionScale ?? 1))
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'vol-confirmed-fade-plus-cold-follow') {
    if (volatilityConfirmsReversion) {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'vol-confirmed-follow+weather-hybrid-reversion' : 'vol-confirmed-weather-hybrid-reversion',
      }
    }
    if (followRow?.thesisKind === 'cold-long') {
      return {
        followRow,
        reversionRow: null,
        followPosition,
        reversionPosition: 0,
        position: followPosition,
        blendLeg: 'dual-cold-follow',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-plus-cold-follow-vol-long') {
    if (followRow?.thesisKind === 'cold-long') {
      const includeReversion = reversionRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = includeReversion
        ? reversionPosition * (reversionRow.thesisKind === 'reversion-long' ? (policy.reversionLongScale ?? 1) : 1)
        : 0
      return {
        followRow,
        reversionRow: includeReversion ? reversionRow : null,
        followPosition,
        reversionPosition: scaledReversionPosition,
        position: clamp(followPosition + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeReversion ? 'confirmed-follow+weather-hybrid-reversion' : 'dual-cold-follow',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-long' && volatilityConfirmsReversion) {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (policy.reversionLongScale ?? 1)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'vol-confirmed-follow+weather-hybrid-reversion' : 'vol-confirmed-weather-hybrid-reversion',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (includeFollow ? 1 : (policy.standaloneReversionScale ?? 1))
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-confirmed-long') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-long' && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'weather-hybrid-parent' && reversionRow) {
    return {
      followRow: null,
      reversionRow,
      followPosition: 0,
      reversionPosition,
      position: reversionPosition,
      blendLeg: 'weather-hybrid-reversion',
    }
  }

  if (policy.conflictPolicy === 'short-fade-only' && reversionRow?.thesisKind === 'reversion-short') {
    return {
      followRow: null,
      reversionRow,
      followPosition: 0,
      reversionPosition,
      position: reversionPosition,
      blendLeg: 'weather-hybrid-reversion',
    }
  }

  if (policy.conflictPolicy === 'follow-first') {
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
  }

  if (policy.conflictPolicy === 'fade-first') {
    if (reversionRow) return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
  }

  if (policy.conflictPolicy === 'short-fade-first') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
  }

  return { followRow, reversionRow, followPosition: 0, reversionPosition: 0, position: 0, blendLeg: 'index-fallback' }
}

function coldFollowStorageDecision(policy, blend, storageContext) {
  const storagePolicy = policy.coldFollowStoragePolicy ?? DEFAULT_STORAGE_POLICY
  if (storagePolicy.kind === 'none') {
    return {
      policyId: storagePolicy.id,
      action: blend.followRow?.thesisKind === 'cold-long' ? 'not-gated' : 'not-cold-follow',
      allowed: true,
    }
  }
  if (blend.followRow?.thesisKind !== 'cold-long' || blend.followPosition === 0) {
    return { policyId: storagePolicy.id, action: 'not-cold-follow', allowed: true }
  }
  if (!storageContext?.available) {
    return { policyId: storagePolicy.id, action: 'missing-storage-blocked', allowed: false }
  }
  if (storagePolicy.kind === 'season-drawdown') {
    const seasonDrawdownBcf = numberFrom(storageContext.storageSeasonDrawdownBcf, Number.NaN)
    const allowed = seasonDrawdownBcf >= storagePolicy.minSeasonDrawdownBcf
    return {
      policyId: storagePolicy.id,
      action: allowed ? 'storage-drawdown-confirmed' : 'blocked-insufficient-storage-drawdown',
      allowed,
      minSeasonDrawdownBcf: storagePolicy.minSeasonDrawdownBcf,
      storageSeasonDrawdownBcf: Number.isFinite(seasonDrawdownBcf) ? round(seasonDrawdownBcf, 2) : '',
    }
  }
  if (storagePolicy.kind === 'seasonal-tight') {
    const storageVsSeasonalAverageBcf = numberFrom(storageContext.storageVsSeasonalAverageBcf, Number.NaN)
    const allowed = Number.isFinite(storageVsSeasonalAverageBcf)
      && storageVsSeasonalAverageBcf <= storagePolicy.maxStorageVsSeasonalAverageBcf
    return {
      policyId: storagePolicy.id,
      action: allowed ? 'storage-seasonal-tight-confirmed' : 'blocked-storage-above-seasonal-normal',
      allowed,
      maxStorageVsSeasonalAverageBcf: storagePolicy.maxStorageVsSeasonalAverageBcf,
      storageVsSeasonalAverageBcf: Number.isFinite(storageVsSeasonalAverageBcf) ? round(storageVsSeasonalAverageBcf, 2) : '',
    }
  }
  if (storagePolicy.kind === 'drawdown-or-seasonal-tight') {
    const seasonDrawdownBcf = numberFrom(storageContext.storageSeasonDrawdownBcf, Number.NaN)
    const storageVsSeasonalAverageBcf = numberFrom(storageContext.storageVsSeasonalAverageBcf, Number.NaN)
    const drawdownConfirmed = Number.isFinite(seasonDrawdownBcf)
      && seasonDrawdownBcf >= storagePolicy.minSeasonDrawdownBcf
    const seasonalTight = Number.isFinite(storageVsSeasonalAverageBcf)
      && storageVsSeasonalAverageBcf <= storagePolicy.maxStorageVsSeasonalAverageBcf
    const allowed = drawdownConfirmed || seasonalTight
    return {
      policyId: storagePolicy.id,
      action: allowed ? 'storage-drawdown-or-seasonal-tight-confirmed' : 'blocked-no-storage-tightness',
      allowed,
      minSeasonDrawdownBcf: storagePolicy.minSeasonDrawdownBcf,
      maxStorageVsSeasonalAverageBcf: storagePolicy.maxStorageVsSeasonalAverageBcf,
      storageSeasonDrawdownBcf: Number.isFinite(seasonDrawdownBcf) ? round(seasonDrawdownBcf, 2) : '',
      storageVsSeasonalAverageBcf: Number.isFinite(storageVsSeasonalAverageBcf) ? round(storageVsSeasonalAverageBcf, 2) : '',
    }
  }
  return { policyId: storagePolicy.id, action: 'kept', allowed: true }
}

function applyColdFollowStorageGate(policy, blend, storageContext) {
  const decision = coldFollowStorageDecision(policy, blend, storageContext)
  if (decision.allowed) return { ...blend, coldFollowStorage: decision }
  return {
    ...blend,
    followRow: null,
    reversionRow: null,
    followPosition: 0,
    reversionPosition: 0,
    position: 0,
    blendLeg: 'index-fallback',
    coldFollowStorage: decision,
  }
}

function followSurvivesDroppedReversion(policy, followRow) {
  if (!followRow) return false
  if (['net-position', 'follow-first'].includes(policy.conflictPolicy)) return true
  if (followRow.thesisKind !== 'cold-long') return false
  return [
    'short-fade-plus-cold-follow',
    'vol-confirmed-fade-plus-cold-follow',
    'short-fade-plus-cold-follow-vol-long',
  ].includes(policy.conflictPolicy)
}

function blendLegAfterWeatherResolution(blend, position) {
  if (position === 0) return 'index-fallback'
  if (blend.followRow && blend.reversionRow) return blend.blendLeg
  if (blend.followRow) return blend.followRow.thesisKind === 'cold-long' ? 'dual-cold-follow' : 'dual-follow'
  if (blend.reversionRow) return blend.blendLeg
  return 'index-fallback'
}

function weatherResolutionDecision(policy, resolution) {
  const resolutionPolicy = policy.weatherResolutionPolicy ?? DEFAULT_RESOLUTION_POLICY
  if (resolutionPolicy.kind === 'none' || !resolution?.available) {
    return {
      ...(resolution ?? { available: false, action: 'no-reversion', scale: 1 }),
      policyId: resolutionPolicy.id,
      action: resolution?.action === 'missing-kept' ? resolution.action : 'none',
      scale: 1,
    }
  }
  if (resolutionPolicy.kind === 'confirm-shift') {
    const confirmed = resolution.sameDirectionShift && resolution.absShiftF >= resolutionPolicy.minShiftF
    return { ...resolution, policyId: resolutionPolicy.id, action: confirmed ? 'confirmed-kept' : 'unconfirmed-dropped', scale: confirmed ? 1 : 0 }
  }
  if (resolutionPolicy.kind === 'confirm-relief') {
    const confirmed = resolution.sameDirectionShift && resolution.reliefF >= resolutionPolicy.minReliefF
    return { ...resolution, policyId: resolutionPolicy.id, action: confirmed ? 'spared-kept' : 'not-spared-dropped', scale: confirmed ? 1 : 0 }
  }
  if (resolutionPolicy.kind === 'block-adverse') {
    const blocked = resolution.adverseDirectionShift && resolution.absShiftF >= resolutionPolicy.minAdverseShiftF
    return { ...resolution, policyId: resolutionPolicy.id, action: blocked ? 'adverse-dropped' : 'not-adverse-kept', scale: blocked ? 0 : 1 }
  }
  if (resolutionPolicy.kind === 'graded-shift') {
    const standaloneAdverseVeto = resolution.blendLeg === 'weather-hybrid-reversion'
      && resolution.adverseDirectionShift
      && WINTER_GRADED_SHIFT_PARAMETERS.dropAdverseStandalone
    if (standaloneAdverseVeto) {
      return { ...resolution, policyId: resolutionPolicy.id, action: 'standalone-adverse-dropped', scale: 0 }
    }
    const scale = resolution.sameDirectionShift
      ? clamp(
          WINTER_GRADED_SHIFT_PARAMETERS.sameDirectionBaseScale
            + resolution.absShiftF / WINTER_GRADED_SHIFT_PARAMETERS.sameDirectionShiftDivisor,
          WINTER_GRADED_SHIFT_PARAMETERS.sameDirectionMinimumScale,
          WINTER_GRADED_SHIFT_PARAMETERS.sameDirectionMaximumScale,
        )
      : resolution.adverseDirectionShift
        ? clamp(
            WINTER_GRADED_SHIFT_PARAMETERS.adverseBaseScale
              - resolution.absShiftF / WINTER_GRADED_SHIFT_PARAMETERS.adverseShiftDivisor,
            WINTER_GRADED_SHIFT_PARAMETERS.adverseMinimumScale,
            WINTER_GRADED_SHIFT_PARAMETERS.adverseMaximumScale,
          )
        : WINTER_GRADED_SHIFT_PARAMETERS.neutralScale
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: resolution.sameDirectionShift ? 'confirm-scaled' : resolution.adverseDirectionShift ? 'adverse-shrunk' : 'neutral-shrunk',
      scale: round(scale, 4),
    }
  }
  return { ...resolution, policyId: resolutionPolicy.id, action: 'kept', scale: 1 }
}

function applyWeatherResolution(policy, blend, weatherResolutionContext) {
  if (!blend.reversionRow || blend.reversionPosition === 0) {
    return {
      ...blend,
      weatherResolution: {
        policyId: policy.weatherResolutionPolicy?.id ?? DEFAULT_RESOLUTION_POLICY.id,
        action: 'no-reversion',
        scale: 1,
      },
    }
  }
  const decision = weatherResolutionDecision(policy, {
    ...(weatherResolutionContext ?? { available: false, action: 'missing-kept', scale: 1 }),
    blendLeg: blend.blendLeg,
  })
  const reversionPosition = blend.reversionPosition * decision.scale
  let followRow = blend.followRow
  let followPosition = blend.followPosition
  const reversionRow = decision.scale === 0 ? null : blend.reversionRow
  if (decision.scale === 0 && !followSurvivesDroppedReversion(policy, followRow)) {
    followRow = null
    followPosition = 0
  }
  const nextBlend = {
    ...blend,
    followRow,
    reversionRow,
    followPosition,
    reversionPosition,
    position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
    weatherResolution: decision,
  }
  return { ...nextBlend, blendLeg: blendLegAfterWeatherResolution(nextBlend, nextBlend.position) }
}

function heatingDemandDecision(policy, row, position, context) {
  const heatingDemandPolicy = policy.heatingDemandPolicy ?? DEFAULT_HEATING_DEMAND_POLICY
  if (heatingDemandPolicy.kind === 'none' || !row || position === 0) {
    return {
      policyId: heatingDemandPolicy.id,
      action: heatingDemandPolicy.kind === 'none' ? 'none' : 'not-follow',
      scale: 1,
    }
  }
  if (!isWinterFollowRow(row) || !['cold-long', 'warm-short'].includes(row.thesisKind)) {
    return { policyId: heatingDemandPolicy.id, action: 'not-follow', scale: 1 }
  }
  if (!context) return { policyId: heatingDemandPolicy.id, action: 'missing-kept', scale: 1 }
  const demandAnomalyF = numberFrom(context.heatingDemandAnomalyF, Number.NaN)
  const thesisDemandDirection = row.thesisKind === 'cold-long' ? 1 : -1
  const confirmsDirection = Number.isFinite(demandAnomalyF) && Math.sign(demandAnomalyF) === thesisDemandDirection
  const demandStrength = Math.abs(demandAnomalyF)
  if (!confirmsDirection) {
    return { ...context, policyId: heatingDemandPolicy.id, action: 'hdd-direction-mismatch-dropped', scale: 0 }
  }
  if (heatingDemandPolicy.kind === 'follow-gate') {
    const kept = demandStrength >= heatingDemandPolicy.minDemandAnomalyF
    return { ...context, policyId: heatingDemandPolicy.id, action: kept ? 'hdd-gate-kept' : 'hdd-gate-dropped', scale: kept ? 1 : 0 }
  }
  if (heatingDemandPolicy.kind === 'follow-tiered') {
    const scale = demandStrength >= WINTER_HEATING_DEMAND_TIERS.strongAnomalyF
      ? WINTER_HEATING_DEMAND_TIERS.strongScale
      : demandStrength >= WINTER_HEATING_DEMAND_TIERS.moderateAnomalyF
        ? WINTER_HEATING_DEMAND_TIERS.moderateScale
        : demandStrength >= heatingDemandPolicy.minDemandAnomalyF
          ? WINTER_HEATING_DEMAND_TIERS.minimumScale
          : WINTER_HEATING_DEMAND_TIERS.subMinimumScale
    return {
      ...context,
      policyId: heatingDemandPolicy.id,
      action: scale > 1 ? 'hdd-scaled-up' : scale < 1 ? 'hdd-scaled-down' : 'hdd-kept',
      scale,
    }
  }
  return { ...context, policyId: heatingDemandPolicy.id, action: 'kept', scale: 1 }
}

function applyHeatingDemandPolicy(policy, blend, heatingDemandContext) {
  const decision = heatingDemandDecision(policy, blend.followRow, blend.followPosition, heatingDemandContext)
  if (decision.scale === 1) return { ...blend, heatingDemand: decision }
  const followPosition = blend.followPosition * decision.scale
  const followRow = decision.scale === 0 ? null : blend.followRow
  const nextBlend = {
    ...blend,
    followRow,
    followPosition,
    position: clamp(followPosition + blend.reversionPosition, -policy.overlayCap, policy.overlayCap),
    heatingDemand: decision,
  }
  return { ...nextBlend, blendLeg: blendLegAfterWeatherResolution(nextBlend, nextBlend.position) }
}

function applyOverlayRiskMultiplier(policy, blend) {
  const multiplier = policy.overlayRiskMultiplier ?? 1
  const effectiveOverlayCap = Math.min(WINTER_MAX_EFFECTIVE_OVERLAY_CAP, policy.overlayCap * multiplier)
  if (multiplier === 1 || blend.position === 0) return { ...blend, overlayRiskMultiplier: multiplier, effectiveOverlayCap }
  const scaledPosition = clamp(blend.position * multiplier, -effectiveOverlayCap, effectiveOverlayCap)
  const realizedMultiplier = blend.position ? scaledPosition / blend.position : 1
  return {
    ...blend,
    followPosition: blend.followPosition * realizedMultiplier,
    reversionPosition: blend.reversionPosition * realizedMultiplier,
    position: scaledPosition,
    overlayRiskMultiplier: multiplier,
    effectiveOverlayCap,
  }
}

function dominantRowFor(policy, blend) {
  const { followRow, reversionRow, position } = blend
  if (policy.conflictPolicy === 'vol-confirmed-fade-plus-cold-follow' && reversionRow) return reversionRow
  if (policy.conflictPolicy === 'net-position' && followRow && reversionRow) {
    return Math.abs(rowPosition(followRow)) >= Math.abs(rowPosition(reversionRow)) ? followRow : reversionRow
  }
  if (position !== 0 && followRow) return followRow
  if (position !== 0 && reversionRow) return reversionRow
  return followRow ?? reversionRow ?? null
}

export function evaluateWinterTargetDecision({
  policy,
  dualRow,
  weatherRow,
  volatilityPosition = 0,
  storageContext = null,
  weatherResolutionContext = null,
  heatingDemandContext = null,
}) {
  const rawBlend = blendPositionFor(policy, dualRow, weatherRow, volatilityPosition)
  const storageGatedBlend = applyColdFollowStorageGate(policy, rawBlend, storageContext)
  const resolvedBlend = applyWeatherResolution(policy, storageGatedBlend, weatherResolutionContext)
  const heatingDemandBlend = applyHeatingDemandPolicy(policy, resolvedBlend, heatingDemandContext)
  const blend = applyOverlayRiskMultiplier(policy, heatingDemandBlend)
  return {
    ...blend,
    dominantRow: dominantRowFor(policy, blend),
  }
}
