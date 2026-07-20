import path from 'node:path'
import process from 'node:process'

export function resolveLiveWeatherPaths(repoDir, env = process.env) {
  const resolvedRepoDir = path.resolve(repoDir)
  const configuredStateDir = typeof env.QORE_LIVE_WEATHER_STATE_DIR === 'string'
    && env.QORE_LIVE_WEATHER_STATE_DIR.trim()
    ? env.QORE_LIVE_WEATHER_STATE_DIR
    : path.join('.local', 'qore', 'live-weather')
  const stateDir = path.resolve(
    resolvedRepoDir,
    configuredStateDir,
  )
  const hasExplicitOperatorStatePath = typeof env.QORE_LIVE_OPERATOR_STATE_FILE === 'string'
    && Boolean(env.QORE_LIVE_OPERATOR_STATE_FILE.trim())
  const configuredOperatorStatePath = hasExplicitOperatorStatePath
    ? env.QORE_LIVE_OPERATOR_STATE_FILE
    : path.join(stateDir, 'operator-state.json')
  const operatorStatePath = path.resolve(
    resolvedRepoDir,
    configuredOperatorStatePath,
  )
  return {
    stateDir,
    operatorStatePath,
    operatorStateSource: hasExplicitOperatorStatePath ? 'QORE_LIVE_OPERATOR_STATE_FILE' : 'QORE_LIVE_WEATHER_STATE_DIR',
  }
}
