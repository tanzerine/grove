/**
 * OAuth provider definitions for the three social platforms.
 *
 * Each needs an app registered on the platform's developer portal and its
 * client id/secret set in env. With creds unset, `isConfigured` is false and
 * the UI shows the platform as unavailable (connect is disabled) instead of
 * throwing.
 *
 * Redirect URI to register on each platform:
 *   {NEXT_PUBLIC_APP_URL}/api/social/{platform}/callback
 */
export type Platform = 'x' | 'linkedin';

export type ProviderConfig = {
  id: Platform;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  usesPKCE: boolean;
  // basic-auth the token endpoint with client_id:client_secret (X requires this)
  tokenBasicAuth: boolean;
  clientId?: string;
  clientSecret?: string;
};

export const PLATFORMS: Platform[] = ['x', 'linkedin'];

export function getProvider(platform: Platform): ProviderConfig {
  switch (platform) {
    case 'x':
      return {
        id: 'x',
        label: 'X',
        authUrl: 'https://twitter.com/i/oauth2/authorize',
        tokenUrl: 'https://api.twitter.com/2/oauth2/token',
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
        usesPKCE: true,
        tokenBasicAuth: true,
        clientId: process.env.X_CLIENT_ID,
        clientSecret: process.env.X_CLIENT_SECRET,
      };
    case 'linkedin':
      return {
        id: 'linkedin',
        label: 'LinkedIn',
        authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
        // openid+profile to read the member URN; w_member_social to post
        scopes: ['openid', 'profile', 'w_member_social'],
        usesPKCE: false,
        tokenBasicAuth: false,
        clientId: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      };
  }
}

export function isConfigured(platform: Platform): boolean {
  const p = getProvider(platform);
  return !!p.clientId && !!p.clientSecret;
}

export function redirectUri(platform: Platform): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return `${base}/api/social/${platform}/callback`;
}
