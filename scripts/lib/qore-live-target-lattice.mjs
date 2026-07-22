import crypto from 'node:crypto'

export const LIVE_TARGET_LATTICE_SCHEMA_VERSION = 1

const SUMMER_TARGET_LATTICE_GENERATOR_ID = 'summer-enumerated-target-lattice-v1'
const WINTER_TARGET_LATTICE_GENERATOR_ID = 'winter-follow-reversion-scale-lattice-v2'
const TARGET_LATTICE_ROUNDING_DECIMAL_PLACES = 4

function roundedTarget(value, decimalPlaces = TARGET_LATTICE_ROUNDING_DECIMAL_PLACES) {
  const factor = 10 ** decimalPlaces
  return Math.round(value * factor) / factor
}

function uniqueSortedTargets(values, decimalPlaces = TARGET_LATTICE_ROUNDING_DECIMAL_PLACES) {
  return [...new Set(values.map((value) => roundedTarget(value, decimalPlaces)))]
    .sort((left, right) => left - right)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

function digestValueSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function summerLiveTargetLattice(selected, implementation) {
  const coolingDemand = implementation.coolingDemand
  const lowDemandReversion = Math.min(
    selected.reversionFraction,
    Math.max(
      coolingDemand.minimumReversionFraction,
      selected.reversionFraction - coolingDemand.lowReversionSubtract,
    ),
  )
  const solidDemandReversion = Math.min(
    coolingDemand.solidMaximumReversionFraction,
    selected.reversionFraction + coolingDemand.solidReversionAdd,
  )
  const extremeDemandReversion = Math.min(
    coolingDemand.extremeMaximumReversionFraction,
    selected.reversionFraction + coolingDemand.extremeReversionAdd,
  )
  return {
    schemaVersion: LIVE_TARGET_LATTICE_SCHEMA_VERSION,
    generatorId: SUMMER_TARGET_LATTICE_GENERATOR_ID,
    roundingDecimalPlaces: TARGET_LATTICE_ROUNDING_DECIMAL_PLACES,
    targetsByWindowAndThesis: {
      'weather-follow': {
        'summer-heat-long': uniqueSortedTargets([
          selected.weatherFraction,
          implementation.storageDeficitHeatMaxFraction,
        ]),
      },
      'weather-reversion': {
        'reversion-short': uniqueSortedTargets([
          -lowDemandReversion,
          -solidDemandReversion,
          -extremeDemandReversion,
        ]),
      },
    },
  }
}

export function winterLiveTargetLattice(selected, implementation) {
  const resolution = implementation.weatherResolution
  const heatingDemand = implementation.heatingDemand
  const resolutionMinimumScale = Math.min(
    resolution.sameDirectionMinimumScale,
    resolution.adverseMinimumScale,
    resolution.neutralScale,
  )
  const resolutionMaximumScale = Math.max(
    resolution.sameDirectionMaximumScale,
    resolution.adverseMaximumScale,
    resolution.neutralScale,
    1,
  )
  const lattice = {
    schemaVersion: LIVE_TARGET_LATTICE_SCHEMA_VERSION,
    generatorId: WINTER_TARGET_LATTICE_GENERATOR_ID,
    roundingDecimalPlaces: TARGET_LATTICE_ROUNDING_DECIMAL_PLACES,
    basePositions: {
      follow: selected.weatherFraction,
      reversion: selected.reversionFraction,
    },
    overlay: {
      rawCap: selected.overlayCap,
      riskMultiplier: selected.overlayRiskMultiplier,
      effectiveCap: selected.effectiveOverlayCap,
    },
    reversionModifiers: {
      standalone: selected.standaloneReversionScale,
      long: selected.reversionLongScale,
    },
    heatingDemandScales: uniqueSortedTargets([
      heatingDemand.subMinimumScale,
      heatingDemand.minimumScale,
      heatingDemand.moderateScale,
      heatingDemand.strongScale,
    ]),
    weatherResolutionScales: {
      minimum: resolutionMinimumScale,
      maximum: resolutionMaximumScale,
      increment: 1 / (10 ** TARGET_LATTICE_ROUNDING_DECIMAL_PLACES),
      includeDroppedZero: true,
    },
  }
  return {
    ...lattice,
    materializedTargetSetsDigestSha256: winterMaterializedTargetSetsDigestSha256(lattice),
  }
}

function winterResolutionScaleValues(lattice) {
  const decimalPlaces = lattice.roundingDecimalPlaces
  const factor = 10 ** decimalPlaces
  const resolution = lattice.weatherResolutionScales
  const minimum = Math.round(resolution.minimum * factor)
  const maximum = Math.round(resolution.maximum * factor)
  const increment = Math.round(resolution.increment * factor)
  if (
    lattice.schemaVersion !== LIVE_TARGET_LATTICE_SCHEMA_VERSION
    || lattice.generatorId !== WINTER_TARGET_LATTICE_GENERATOR_ID
    || !Number.isInteger(decimalPlaces)
    || decimalPlaces < 0
    || decimalPlaces > 8
    || !Number.isInteger(minimum)
    || !Number.isInteger(maximum)
    || !Number.isInteger(increment)
    || minimum < 0
    || maximum < minimum
    || increment <= 0
    || (maximum - minimum) / increment > 100_000
  ) return []
  const values = resolution.includeDroppedZero === true ? [0] : []
  for (let scaled = minimum; scaled <= maximum; scaled += increment) {
    values.push(scaled / factor)
  }
  return values
}

function winterLatticeTargets(lattice, windowId, thesisKind) {
  const scales = winterResolutionScaleValues(lattice)
  if (!scales.length) return []
  const decimalPlaces = lattice.roundingDecimalPlaces
  const baseFollow = Number(lattice.basePositions?.follow)
  const baseReversion = Number(lattice.basePositions?.reversion)
  const rawCap = Number(lattice.overlay?.rawCap)
  const riskMultiplier = Number(lattice.overlay?.riskMultiplier)
  const effectiveCap = Number(lattice.overlay?.effectiveCap)
  const standaloneModifier = Number(lattice.reversionModifiers?.standalone)
  const longModifier = Number(lattice.reversionModifiers?.long)
  const heatingDemandScales = lattice.heatingDemandScales?.map(Number) ?? []
  if (
    [
      baseFollow,
      baseReversion,
      rawCap,
      riskMultiplier,
      effectiveCap,
      standaloneModifier,
      longModifier,
      ...heatingDemandScales,
    ].some((value) => !Number.isFinite(value) || value < 0)
    || !heatingDemandScales.length
  ) return []

  const signedTargets = []
  if (
    ['weather-follow', 'winter-alpha-blend'].includes(windowId)
    && ['cold-long', 'warm-short'].includes(thesisKind)
  ) {
    const permittedScales = thesisKind === 'cold-long'
      ? scales
      : scales.filter((scale) => scale > 0)
    const reversionModifier = thesisKind === 'cold-long' ? longModifier : 1
    for (const heatingScale of heatingDemandScales) {
      for (const resolutionScale of permittedScales) {
        const rawMagnitude = Math.min(
          baseFollow * heatingScale
            + baseReversion * resolutionScale * reversionModifier,
          rawCap,
        )
        const magnitude = Math.min(rawMagnitude * riskMultiplier, effectiveCap)
        signedTargets.push(thesisKind === 'cold-long' ? magnitude : -magnitude)
      }
    }
  } else if (
    windowId === 'weather-reversion'
    && ['reversion-long', 'reversion-short'].includes(thesisKind)
  ) {
    const modifier = thesisKind === 'reversion-long' ? longModifier : standaloneModifier
    for (const resolutionScale of scales.filter((scale) => scale > 0)) {
      const rawMagnitude = Math.min(baseReversion * resolutionScale * modifier, rawCap)
      const magnitude = Math.min(rawMagnitude * riskMultiplier, effectiveCap)
      signedTargets.push(thesisKind === 'reversion-long' ? magnitude : -magnitude)
    }
  }
  return uniqueSortedTargets(signedTargets, decimalPlaces)
}

function winterMaterializedTargetSets(lattice) {
  return {
    schemaVersion: LIVE_TARGET_LATTICE_SCHEMA_VERSION,
    generatorId: WINTER_TARGET_LATTICE_GENERATOR_ID,
    roundingDecimalPlaces: lattice?.roundingDecimalPlaces,
    targetsByWindowAndThesis: {
      'weather-follow': {
        'cold-long': winterLatticeTargets(lattice, 'weather-follow', 'cold-long'),
        'warm-short': winterLatticeTargets(lattice, 'weather-follow', 'warm-short'),
      },
      'winter-alpha-blend': {
        'cold-long': winterLatticeTargets(lattice, 'winter-alpha-blend', 'cold-long'),
        'warm-short': winterLatticeTargets(lattice, 'winter-alpha-blend', 'warm-short'),
      },
      'weather-reversion': {
        'reversion-long': winterLatticeTargets(lattice, 'weather-reversion', 'reversion-long'),
        'reversion-short': winterLatticeTargets(lattice, 'weather-reversion', 'reversion-short'),
      },
    },
  }
}

export function winterMaterializedTargetSetsDigestSha256(lattice) {
  return digestValueSha256(winterMaterializedTargetSets(lattice))
}

export function gasPositionTargetsFromLiveLattice(lattice, windowId, thesisKind) {
  if (
    lattice?.schemaVersion !== LIVE_TARGET_LATTICE_SCHEMA_VERSION
    || !Number.isInteger(lattice.roundingDecimalPlaces)
  ) return []
  if (lattice.generatorId === SUMMER_TARGET_LATTICE_GENERATOR_ID) {
    const targets = lattice.targetsByWindowAndThesis?.[windowId]?.[thesisKind]
    return Array.isArray(targets) ? [...targets] : []
  }
  if (lattice.generatorId === WINTER_TARGET_LATTICE_GENERATOR_ID) {
    if (
      !/^[a-f0-9]{64}$/.test(lattice.materializedTargetSetsDigestSha256 ?? '')
      || lattice.materializedTargetSetsDigestSha256
        !== winterMaterializedTargetSetsDigestSha256(lattice)
    ) return []
    return winterLatticeTargets(lattice, windowId, thesisKind)
  }
  return []
}
