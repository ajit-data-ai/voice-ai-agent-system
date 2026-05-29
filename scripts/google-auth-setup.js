/**
 * ONE-TIME Google OAuth Setup Script
 * Run this once per client to get their Google Refresh Token
 *
 * Usage:
 *   1. Fill in CLIENT_ID and CLIENT_SECRET below (from Google Cloud Console)
 *   2. node scripts/google-auth-setup.js
 *   3. Open the URL it prints in your browser
 *   4. Authorize the Google account
 *   5. Copy the refresh_token it prints → paste into .env
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');

// ── FILL THESE IN ────────────────────────────────────────────
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || 'PASTE_YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI  = 'http://localhost:3000/auth/google/callback';
// ─────────────────────────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Forces refresh token to be returned every time
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  GOOGLE CALENDAR AUTH SETUP');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Sign in with the Google account that owns the calendar');
console.log('3. Click Allow');
console.log('4. The refresh token will appear here automatically\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Spin up a temporary local server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname !== '/auth/google/callback') {
    res.end('Not found');
    return;
  }

  const code = parsedUrl.query.code;
  const error = parsedUrl.query.error;

  if (error) {
    console.error('❌ Authorization failed:', error);
    res.end('<h2>Authorization failed. Check the terminal.</h2>');
    server.close();
    return;
  }

  if (!code) {
    console.error('❌ No authorization code received');
    res.end('<h2>No code received. Try again.</h2>');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('✅ SUCCESS! Add this to your .env file:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REDIRECT_URI=${REDIRECT_URI}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (!tokens.refresh_token) {
      console.warn('⚠️  No refresh_token in response.');
      console.warn('   Fix: Go to https://myaccount.google.com/permissions');
      console.warn('   Remove "Voice AI Agent" access, then run this script again.\n');
    }

    res.end(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>✅ Authorization Successful!</h2>
        <p>Go back to your terminal to copy the credentials.</p>
        <p>You can close this tab.</p>
      </body></html>
    `);

  } catch (err) {
    console.error('❌ Token exchange failed:', err.message);
    res.end('<h2>Token exchange failed. Check the terminal.</h2>');
  }

  server.close(() => {
    console.log('Auth server closed. Setup complete!');
    process.exit(0);
  });
});

server.listen(3000, () => {
  console.log('Waiting for Google authorization...\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('❌ Port 3000 is already in use.');
    console.error('   Stop your dev server first, then run this script again.');
    process.exit(1);
  }
  throw err;
});
