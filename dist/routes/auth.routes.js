import { Router } from 'express';
import { linkedInOAuthService } from '../services/linkedin-oauth.service.js';
const router = Router();
/**
 * Step 1: Redirect to LinkedIn Login
 */
router.get('/linkedin', (req, res) => {
    try {
        const authUrl = linkedInOAuthService.getAuthorizationUrl();
        console.log(`[AuthRoutes] Redirecting user to LinkedIn OAuth: ${authUrl}`);
        return res.redirect(authUrl);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
/**
 * Step 2: OAuth Callback handler
 */
router.get('/linkedin/callback', async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;
    const errorDescription = req.query.error_description;
    if (error) {
        return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>LinkedIn Connection Failed</title></head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #e53e3e;">❌ LinkedIn Authorization Failed</h2>
          <p><strong>Error:</strong> ${error}</p>
          <p>${errorDescription || ''}</p>
          <a href="/api/auth/linkedin" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0077b5; color: white; text-decoration: none; border-radius: 5px;">Try Again</a>
        </body>
      </html>
    `);
    }
    if (!code) {
        return res.status(400).json({ error: 'Missing authorization code in callback' });
    }
    try {
        const result = await linkedInOAuthService.handleCallback(code);
        return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>LinkedIn Connected Successfully</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6; padding: 60px 20px; text-align: center; }
            .card { background: white; max-width: 520px; margin: 0 auto; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
            .badge { display: inline-block; background: #e0f2fe; color: #0284c7; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; margin-bottom: 16px; }
            h1 { color: #111827; margin: 0 0 12px 0; font-size: 24px; }
            p { color: #4b5563; font-size: 15px; line-height: 1.5; margin: 6px 0; }
            .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0; text-align: left; font-size: 13px; color: #374151; font-family: monospace; word-break: break-all; }
            .btn { display: inline-block; background: #0077b5; color: white; padding: 12px 28px; border-radius: 8px; font-weight: 600; text-decoration: none; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">Connected to LinkedIn</div>
            <h1>🎉 Ready to Publish!</h1>
            <p>Welcome, <strong>${result.name || 'LinkedIn Member'}</strong>!</p>
            <p>Your access token and author URN have been automatically saved to <code>.env</code>.</p>
            
            <div class="info-box">
              <div><strong>Author URN:</strong> ${result.authorUrn}</div>
              <div style="margin-top: 6px;"><strong>Token Expiry:</strong> ${Math.round(result.expiresIn / 86400)} days</div>
            </div>

            <p style="font-size: 13px; color: #6b7280;">You can now close this tab and start scheduling posts!</p>
          </div>
        </body>
      </html>
    `);
    }
    catch (err) {
        console.error('[AuthRoutes] Callback exchange failed:', err);
        return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>LinkedIn Connection Error</title></head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #e53e3e;">❌ Connection Error</h2>
          <p>${err.message}</p>
          <a href="/api/auth/linkedin" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0077b5; color: white; text-decoration: none; border-radius: 5px;">Try Again</a>
        </body>
      </html>
    `);
    }
});
export default router;
