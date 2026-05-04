import memoize from 'lodash-es/memoize.js'
import { getSessionId } from '../bootstrap/state.js'
import {
  getOauthAccountInfo,
  getRateLimitTier,
  getSubscriptionType,
} from './auth.js'

// User data tracking is disabled in the OSS build.
// This module provides stub implementations.

/**
 * GitHub Actions metadata when running in CI
 * Disabled in OSS build.
 */
export type GitHubActionsMetadata = {
  actor?: string
  actorId?: string
  repository?: string
  repositoryId?: string
  repositoryOwner?: string
  repositoryOwnerId?: string
}

/**
 * Core user data used as base for all analytics providers.
 * Disabled in OSS build - deviceId is empty.
 */
export type CoreUserData = {
  deviceId: string
  sessionId: string
  email?: string
  appVersion: string
  platform: string
  organizationUuid?: string
  accountUuid?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  githubActionsMetadata?: GitHubActionsMetadata
}

/**
 * Initialize user data asynchronously.
 * Disabled in OSS build - no-op.
 */
export async function initUser(): Promise<void> {
  // No-op in OSS build
}

/**
 * Reset all user data caches.
 * Disabled in OSS build - no-op.
 */
export function resetUserCache(): void {
  // No-op in OSS build
}

/**
 * Get core user data.
 * Disabled in OSS build - returns empty/anonymized data.
 */
export const getCoreUserData = memoize(
  (_includeAnalyticsMetadata?: boolean): CoreUserData => {
    return {
      deviceId: '00000000-0000-0000-0000-000000000000',
      sessionId: getSessionId(),
      email: undefined,
      appVersion: MACRO.VERSION,
      platform: 'unknown',
      organizationUuid: undefined,
      accountUuid: undefined,
      userType: 'external',
      subscriptionType: undefined,
      rateLimitTier: undefined,
      firstTokenTime: undefined,
    }
  },
)

/**
 * Get user data for GrowthBook.
 * Disabled in OSS build - returns anonymized data.
 */
export function getUserForGrowthBook(): CoreUserData {
  return getCoreUserData(true)
}

/**
 * Get the user's git email.
 * Disabled in OSS build - returns undefined.
 */
export const getGitEmail = memoize(
  async (): Promise<string | undefined> => {
    return undefined
  },
)
