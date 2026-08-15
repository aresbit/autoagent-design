import { createHash } from 'crypto'
import type { AssistantMessage, UserMessage } from '../types/message.js'

/**
 * Fingerprint computation is disabled in the OSS build.
 * Returns a static placeholder to avoid breaking API contract.
 */
export const FINGERPRINT_SALT = ''

/**
 * Extracts text content from the first user message.
 * Disabled in OSS build.
 */
export function extractFirstMessageText(
  _messages: (UserMessage | AssistantMessage)[],
): string {
  return ''
}

/**
 * Computes 3-character fingerprint for Claude Code attribution.
 * Disabled in OSS build - returns static '000'.
 */
export function computeFingerprint(
  _messageText: string,
  _version: string,
): string {
  return '000'
}

/**
 * Computes fingerprint from the first user message.
 * Disabled in OSS build - returns static '000'.
 */
export function computeFingerprintFromMessages(
  _messages: (UserMessage | AssistantMessage)[],
): string {
  return '000'
}
