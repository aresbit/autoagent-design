/**
 * GrowthBook feature flagging system
 *
 * DISABLED IN OSS BUILD - provides stub implementations.
 */

export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
}

/**
 * Register a callback to fire when GrowthBook feature values refresh.
 * Disabled in OSS build - callback is never called.
 */
export function onGrowthBookRefresh(
  _listener: () => void | Promise<void>,
): () => void {
  return () => {}
}

/**
 * Check if a feature has an env-var override.
 * Disabled in OSS build - always returns false.
 */
export function hasGrowthBookEnvOverride(_feature: string): boolean {
  return false
}

/**
 * Enumerate all known GrowthBook features.
 * Disabled in OSS build - returns empty object.
 */
export function getAllGrowthBookFeatures(): Record<string, unknown> {
  return {}
}

/**
 * Get GrowthBook config overrides.
 * Disabled in OSS build - returns empty object.
 */
export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return {}
}

/**
 * Set or clear a single config override.
 * Disabled in OSS build - no-op.
 */
export function setGrowthBookConfigOverride(
  _feature: string,
  _value: unknown,
): void {
  // No-op
}

/**
 * Clear all GrowthBook config overrides.
 * Disabled in OSS build - no-op.
 */
export function clearGrowthBookConfigOverrides(): void {
  // No-op
}

/**
 * Get API base URL host for GrowthBook attributes.
 * Disabled in OSS build - returns undefined.
 */
export function getApiBaseUrlHost(): string | undefined {
  return undefined
}

/**
 * Initialize GrowthBook client (blocks until ready).
 * Disabled in OSS build - returns null immediately.
 */
export async function initializeGrowthBook(): Promise<null> {
  return null
}

/**
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE instead.
 * Disabled in OSS build - returns default value.
 */
export async function getFeatureValue_DEPRECATED<T>(
  _feature: string,
  defaultValue: T,
): Promise<T> {
  return defaultValue
}

/**
 * Get a feature value from cache immediately.
 * Disabled in OSS build - always returns default value.
 */
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _feature: string,
  defaultValue: T,
): T {
  return defaultValue
}

/**
 * Check a Statsig feature gate via GrowthBook.
 * Disabled in OSS build - always returns false.
 */
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  _gate: string,
): boolean {
  return false
}

/**
 * Check a security restriction gate.
 * Disabled in OSS build - always returns false.
 */
export async function checkSecurityRestrictionGate(
  _gate: string,
): Promise<boolean> {
  return false
}

/**
 * Check a boolean entitlement gate.
 * Disabled in OSS build - always returns false.
 */
export async function checkGate_CACHED_OR_BLOCKING(
  _gate: string,
): Promise<boolean> {
  return false
}

/**
 * Refresh GrowthBook after auth changes.
 * Disabled in OSS build - no-op.
 */
export function refreshGrowthBookAfterAuthChange(): void {
  // No-op
}

/**
 * Reset GrowthBook client state.
 * Disabled in OSS build - no-op.
 */
export function resetGrowthBook(): void {
  // No-op
}

/**
 * Light refresh - re-fetch features from server.
 * Disabled in OSS build - no-op.
 */
export async function refreshGrowthBookFeatures(): Promise<void> {
  // No-op
}

/**
 * Set up periodic refresh of GrowthBook features.
 * Disabled in OSS build - no-op.
 */
export function setupPeriodicGrowthBookRefresh(): void {
  // No-op
}

/**
 * Stop periodic refresh.
 * Disabled in OSS build - no-op.
 */
export function stopPeriodicGrowthBookRefresh(): void {
  // No-op
}

/**
 * Get a dynamic config value - blocks until initialized.
 * Disabled in OSS build - returns default value.
 */
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  _configName: string,
  defaultValue: T,
): Promise<T> {
  return defaultValue
}

/**
 * Get a dynamic config value from cache immediately.
 * Disabled in OSS build - returns default value.
 */
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  _configName: string,
  defaultValue: T,
): T {
  return defaultValue
}

/**
 * Get a feature value with cached refresh semantics.
 * Disabled in OSS build - returns default value.
 */
export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  _feature: string,
  defaultValue: T,
  _refreshMs: number,
): T {
  return defaultValue
}
