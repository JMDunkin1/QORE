export type ArcticBlastLeadWindow = {
  id: 'rumor' | 'selloff' | 'postEvent'
  label: string
  minLeadDays: number
  maxLeadDays: number
  tradeQuestion: string
}

export type ArcticBlastLocation = {
  id: string
  name: string
  latitude: number
  longitude: number
  region: string
  weight: number
}

export type ArcticBlastForecastModel = {
  id: string
  label: string
  provider: 'ECMWF' | 'NCEP' | 'GEM'
  endpoint: 'ecmwf' | 'gfs' | 'gem'
  forecastDays: number
  verifiedModelParam?: string
  notes?: string
}

export type ArcticBlastAnomalyPoint = {
  locationId: string
  anomalyF: number
  modelId: string
  leadDays: number
}

export type ArcticBlastScore = {
  weightedAnomalyF: number
  coveragePct: number
  extremeCount: number
  modelCount: number
  confidence: number
  qualifies: boolean
}

export const arcticBlastLeadWindows: ArcticBlastLeadWindow[] = [
  {
    id: 'rumor',
    label: '7 to 10 day rumor window',
    minLeadDays: 7,
    maxLeadDays: 10,
    tradeQuestion: 'Does broad forecast cold trigger a UNG bid before the event is near?',
  },
  {
    id: 'selloff',
    label: '1 to 3 day selloff window',
    minLeadDays: 1,
    maxLeadDays: 3,
    tradeQuestion: 'Does UNG fade as the cold event moves from forecast risk to known news?',
  },
  {
    id: 'postEvent',
    label: 'Event day through T+1',
    minLeadDays: -1,
    maxLeadDays: 0,
    tradeQuestion: 'Does the fade continue after the cold arrives?',
  },
]

export const easternConusDemandBasket: ArcticBlastLocation[] = [
  { id: 'minneapolis', name: 'Minneapolis', latitude: 44.9778, longitude: -93.265, region: 'Upper Midwest', weight: 0.07 },
  { id: 'chicago', name: 'Chicago', latitude: 41.8781, longitude: -87.6298, region: 'Great Lakes', weight: 0.09 },
  { id: 'detroit', name: 'Detroit', latitude: 42.3314, longitude: -83.0458, region: 'Great Lakes', weight: 0.06 },
  { id: 'cleveland', name: 'Cleveland', latitude: 41.4993, longitude: -81.6944, region: 'Great Lakes', weight: 0.05 },
  { id: 'indianapolis', name: 'Indianapolis', latitude: 39.7684, longitude: -86.1581, region: 'Ohio Valley', weight: 0.05 },
  { id: 'st-louis', name: 'St. Louis', latitude: 38.627, longitude: -90.1994, region: 'Midwest', weight: 0.05 },
  { id: 'kansas-city', name: 'Kansas City', latitude: 39.0997, longitude: -94.5786, region: 'Central Plains', weight: 0.04 },
  { id: 'nashville', name: 'Nashville', latitude: 36.1627, longitude: -86.7816, region: 'Mid-South', weight: 0.05 },
  { id: 'memphis', name: 'Memphis', latitude: 35.1495, longitude: -90.049, region: 'Mid-South', weight: 0.04 },
  { id: 'atlanta', name: 'Atlanta', latitude: 33.749, longitude: -84.388, region: 'Southeast', weight: 0.07 },
  { id: 'charlotte', name: 'Charlotte', latitude: 35.2271, longitude: -80.8431, region: 'Southeast', weight: 0.05 },
  { id: 'raleigh', name: 'Raleigh', latitude: 35.7796, longitude: -78.6382, region: 'Southeast', weight: 0.04 },
  { id: 'washington-dc', name: 'Washington, DC', latitude: 38.9072, longitude: -77.0369, region: 'Mid-Atlantic', weight: 0.07 },
  { id: 'philadelphia', name: 'Philadelphia', latitude: 39.9526, longitude: -75.1652, region: 'Mid-Atlantic', weight: 0.06 },
  { id: 'new-york', name: 'New York', latitude: 40.7128, longitude: -74.006, region: 'Northeast', weight: 0.11 },
  { id: 'boston', name: 'Boston', latitude: 42.3601, longitude: -71.0589, region: 'Northeast', weight: 0.06 },
  { id: 'dallas', name: 'Dallas', latitude: 32.7767, longitude: -96.797, region: 'Texas/Oklahoma fringe', weight: 0.05 },
  { id: 'houston', name: 'Houston', latitude: 29.7604, longitude: -95.3698, region: 'Texas/Oklahoma fringe', weight: 0.05 },
]

export const arcticBlastForecastModels: ArcticBlastForecastModel[] = [
  {
    id: 'ecmwf-ifs-025',
    label: 'ECMWF IFS 0.25 degree',
    provider: 'ECMWF',
    endpoint: 'ecmwf',
    forecastDays: 15,
    verifiedModelParam: 'ecmwf_ifs025',
  },
  {
    id: 'ecmwf-aifs-025',
    label: 'ECMWF AIFS 0.25 degree',
    provider: 'ECMWF',
    endpoint: 'ecmwf',
    forecastDays: 15,
    verifiedModelParam: 'ecmwf_aifs025',
  },
  {
    id: 'ncep-gfs-global',
    label: 'NCEP GFS Global 0.11/0.25 degree',
    provider: 'NCEP',
    endpoint: 'gfs',
    forecastDays: 16,
    verifiedModelParam: 'gfs_global',
  },
  {
    id: 'ncep-gfs-025',
    label: 'NCEP GFS pressure grid 0.25 degree',
    provider: 'NCEP',
    endpoint: 'gfs',
    forecastDays: 16,
    verifiedModelParam: 'gfs025',
  },
  {
    id: 'ncep-aigfs-025',
    label: 'NCEP AIGFS 0.25 degree',
    provider: 'NCEP',
    endpoint: 'gfs',
    forecastDays: 16,
    notes: 'Documented by Open-Meteo; exact model selector still needs live confirmation.',
  },
  {
    id: 'ncep-hgefs-025',
    label: 'NCEP HGEFS 0.25 degree ensemble mean',
    provider: 'NCEP',
    endpoint: 'gfs',
    forecastDays: 10,
    notes: 'Documented by Open-Meteo; exact model selector still needs live confirmation.',
  },
  {
    id: 'gem-global',
    label: 'GEM Global',
    provider: 'GEM',
    endpoint: 'gem',
    forecastDays: 10,
    verifiedModelParam: 'gem_global',
  },
]

export const arcticBlastThresholds = {
  coldAnomalyF: -8,
  extremeAnomalyF: -14,
  minCoveragePct: 0.55,
  minModelCount: 3,
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function scoreArcticBlast(points: ArcticBlastAnomalyPoint[]): ArcticBlastScore {
  const locationWeights = new Map(easternConusDemandBasket.map((location) => [location.id, location.weight]))
  const basketWeight = easternConusDemandBasket.reduce((sum, location) => sum + location.weight, 0)
  const usablePoints = points.filter((point) => locationWeights.has(point.locationId))
  const pointsByLocation = new Map<string, ArcticBlastAnomalyPoint[]>()

  for (const point of usablePoints) {
    pointsByLocation.set(point.locationId, [...(pointsByLocation.get(point.locationId) ?? []), point])
  }

  const locationScores = Array.from(pointsByLocation.entries()).map(([locationId, locationPoints]) => ({
    locationId,
    anomalyF: average(locationPoints.map((point) => point.anomalyF)),
    weight: locationWeights.get(locationId) ?? 0,
  }))
  const sampledWeight = locationScores.reduce((sum, location) => sum + location.weight, 0)
  const coldWeight = locationScores
    .filter((location) => location.anomalyF <= arcticBlastThresholds.coldAnomalyF)
    .reduce((sum, location) => sum + location.weight, 0)
  const weightedAnomalyF = sampledWeight
    ? locationScores.reduce((sum, location) => sum + location.anomalyF * location.weight, 0) / sampledWeight
    : 0
  const coveragePct = basketWeight ? coldWeight / basketWeight : 0
  const modelCount = new Set(usablePoints.map((point) => point.modelId)).size
  const extremeCount = locationScores.filter((location) => location.anomalyF <= arcticBlastThresholds.extremeAnomalyF).length
  const anomalyConfidence = Math.min(1, Math.abs(Math.min(weightedAnomalyF, 0)) / Math.abs(arcticBlastThresholds.extremeAnomalyF))
  const confidence = anomalyConfidence * 0.55 + coveragePct * 0.35 + Math.min(1, modelCount / arcticBlastThresholds.minModelCount) * 0.1
  const qualifies =
    weightedAnomalyF <= arcticBlastThresholds.coldAnomalyF &&
    coveragePct >= arcticBlastThresholds.minCoveragePct &&
    modelCount >= arcticBlastThresholds.minModelCount

  return {
    weightedAnomalyF: round(weightedAnomalyF, 2),
    coveragePct: round(coveragePct),
    extremeCount,
    modelCount,
    confidence: round(confidence),
    qualifies,
  }
}
