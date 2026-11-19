import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

export interface LinkedInOAuthResult {
  accessToken: string;
  expiresIn: number;
  authorUrn: string;
  name?: string;
  email?: string;
}

export class LinkedInOAuthService {
  /**
   * Generates the LinkedIn OAuth authorization URL
   */
  public getAuthorizationUrl(scopes = ['openid', 'profile', 'email', 'w_member_social']): string {
    if (!config.linkedin.clientId) {
      throw new Error('LINKEDIN_CLIENT_ID is not configured in .env');
    }

    const scopeStr = scopes.join(' ');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.linkedin.clientId,
      redirect_uri: config.linkedin.redirectUri,
      scope: scopeStr,
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for an Access Token and retrieves the Member URN
   */
  public async handleCallback(code: string): Promise<LinkedInOAuthResult> {
    if (!config.linkedin.clientId || !config.linkedin.clientSecret) {
      throw new Error('LinkedIn Client ID or Client Secret missing in .env');
    }

    console.log('[LinkedInOAuth] Exchanging authorization code for access token...');

    // 1. Exchange code for access_token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
      redirect_uri: config.linkedin.redirectUri,
    });

    const tokenResponse = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      tokenParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    const expiresIn = tokenResponse.data.expires_in;

    if (!accessToken) {
      throw new Error('Failed to retrieve access token from LinkedIn');
    }

    console.log('[LinkedInOAuth] Access token obtained. Fetching member profile (userinfo)...');

    // 2. Fetch Member Info (OpenID Connect userinfo endpoint)
    let authorUrn = '';
    let name = '';
    let email = '';

    try {
      const userinfoResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const userInfo = userinfoResponse.data;
      authorUrn = `urn:li:person:${userInfo.sub}`;
      name = userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim();
      email = userInfo.email || '';
      console.log(`[LinkedInOAuth] Successfully identified member: ${name} (${authorUrn})`);
    } catch (err: any) {
      console.warn('[LinkedInOAuth] Could not fetch OpenID userinfo, falling back to legacy /v2/me:', err.message);
      try {
        const meResponse = await axios.get('https://api.linkedin.com/v2/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        authorUrn = `urn:li:person:${meResponse.data.id}`;
        name = `${meResponse.data.localizedFirstName || ''} ${meResponse.data.localizedLastName || ''}`.trim();
      } catch (meErr: any) {
        throw new Error(`Failed to fetch LinkedIn profile: ${meErr.message}`);
      }
    }

    // 3. Update runtime configuration
    config.linkedin.accessToken = accessToken;
    config.linkedin.authorUrn = authorUrn;
    config.linkedin.mockMode = false;

    // 4. Automatically persist to .env
    this.updateEnvFile({
      LINKEDIN_ACCESS_TOKEN: accessToken,
      LINKEDIN_AUTHOR_URN: authorUrn,
      LINKEDIN_MOCK_MODE: 'false',
    });

    return {
      accessToken,
      expiresIn,
      authorUrn,
      name,
      email,
    };
  }

  /**
   * Helper to write new tokens into .env file
   */
  private updateEnvFile(updates: Record<string, string>) {
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) return;

      let envContent = fs.readFileSync(envPath, 'utf-8');

      for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
      console.log('[LinkedInOAuth] Automatically updated .env file with new credentials!');
    } catch (err: any) {
      console.error('[LinkedInOAuth] Failed to auto-update .env file:', err.message);
    }
  }
}

export const linkedInOAuthService = new LinkedInOAuthService();
