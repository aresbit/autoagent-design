/**
 * XAA IdP Login — stubbed implementation because feature flags are disabled.
 * All functions return empty values or throw errors.
 */

export function isXaaEnabled(): boolean {
  return false;
}

export type XaaIdpSettings = {
  issuer: string;
  clientId: string;
  callbackPort?: number;
};

export function getXaaIdpSettings(): XaaIdpSettings | undefined {
  return undefined;
}

export function issuerKey(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

export function getCachedIdpIdToken(idpIssuer: string): string | undefined {
  return undefined;
}

export function saveIdpIdToken(idpIssuer: string, idToken: string, expiresAt: number): void {
  // no-op
}

export function saveIdpIdTokenFromJwt(idpIssuer: string, idToken: string): number {
  return Date.now() + 3600 * 1000;
}

export function clearIdpIdToken(idpIssuer: string): void {
  // no-op
}

export function saveIdpClientSecret(
  idpIssuer: string,
  clientSecret: string,
): { success: boolean; warning?: string } {
  return { success: true };
}

export function getIdpClientSecret(idpIssuer: string): string | undefined {
  return undefined;
}

export function clearIdpClientSecret(idpIssuer: string): void {
  // no-op
}

export async function discoverOidc(idpIssuer: string): Promise<any> {
  throw new Error('XAA disabled: OIDC discovery not available');
}

export async function acquireIdpIdToken(opts: any): Promise<string> {
  throw new Error('XAA disabled: IdP login not available');
}