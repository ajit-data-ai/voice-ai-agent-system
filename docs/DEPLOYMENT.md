# Deployment Guide — Production Setup

## STEP 1: LOCAL DEVELOPMENT

```bash
# Clone / navigate to project
cd voice-ai-agent-system

# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Fill in .env with your credentials

# Start dev server with auto-reload
npm run dev

# Expose to internet for Retell webhooks
npx ngrok http 3000
# Copy the https URL → use in Retell dashboard
```

---

## STEP 2: GOOGLE CALENDAR OAUTH SETUP (One-time per client)

```bash
# Run the auth helper script (creates refresh token)
node scripts/google-auth-setup.js

# Visit the URL it prints
# Authorize the Google account
# Copy the refresh token → paste into .env GOOGLE_REFRESH_TOKEN
```

**Why refresh token:** Access tokens expire in 1 hour. Refresh tokens last indefinitely (until revoked). You get one by completing OAuth once.

---

## STEP 3: RETELL AI AGENT CONFIGURATION

1. Log in to [Retell Dashboard](https://app.retellai.com)
2. Create new agent → "Custom LLM" or "Hosted LLM"
3. Set webhook URL: `https://your-domain.com/retell-webhook`
4. Set LLM WebSocket URL (if custom LLM): `wss://your-domain.com/llm-websocket/{{call_id}}`
5. Paste contents of `agents/dental/system-prompt.txt` into the prompt field
6. Add all functions from `config/agent-config.json` → Tools section
7. Configure post-call analysis fields
8. Set voice: ElevenLabs "Rachel" or "Adam" (natural, professional)
9. Copy the Agent ID → save in `.env` as `RETELL_AGENT_ID`

---

## STEP 4: TWILIO PHONE NUMBER SETUP

```
1. Buy a local number in Retell dashboard (Retell handles Twilio under the hood)
   OR
   Buy number in Twilio → configure webhook to Retell's inbound call URL

2. In Retell Dashboard:
   - Phone Numbers → Import Number
   - Assign to your agent

3. Test: Call the number → agent should answer within 1 ring
```

---

## STEP 5: PRODUCTION DEPLOYMENT (Recommended: Railway or Render)

### Option A: Railway (Easiest — $5/mo)
```bash
npm install -g @railway/cli
railway login
railway init
railway up

# Set environment variables in Railway dashboard
# Your webhook URL: https://your-app.railway.app
```

### Option B: Render (Free tier available)
```
1. Create new Web Service on Render
2. Connect GitHub repo
3. Build command: npm install
4. Start command: npm start
5. Add all env vars in Render dashboard
6. Deploy
```

### Option C: VPS (DigitalOcean $6/mo droplet)
```bash
# On server:
git clone your-repo
cd voice-ai-agent-system
npm install --production
cp .env.example .env && nano .env

# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name "voice-agent"
pm2 startup  # Auto-start on server reboot
pm2 save

# Install Caddy for HTTPS (free SSL)
apt install -y caddy
# Configure Caddy for your domain
```

---

## STEP 6: PER-CLIENT ONBOARDING (2-4 hours)

```
[ ] 1. Duplicate config/clinic-config.json → config/clients/[client-name].json
[ ] 2. Fill ALL fields (name, hours, services, doctors, insurance)
[ ] 3. Do Google Calendar OAuth for their Google account
[ ] 4. Buy Twilio number (or use Retell's built-in number)
[ ] 5. Create new Retell agent (clone from dental template)
[ ] 6. Update system prompt variables with client-specific data
[ ] 7. Set webhook URL in Retell to your server
[ ] 8. Run full test suite (tests/scenarios.md)
[ ] 9. Do a live test call with the client watching
[ ] 10. Hand over reporting dashboard access
```

---

## MONITORING SETUP

### UptimeRobot (Free)
- Add monitor: `https://your-domain.com/health`
- Alert email: your email + client's email
- Check interval: 5 minutes

### Log Monitoring (Free — Papertrail or Logtail)
```bash
# Install log shipping agent on your VPS
# Or use Railway/Render built-in logs
```

### Weekly Client Report (automate with n8n)
- Total calls this week
- Appointments booked
- Calls transferred
- Any failed bookings
- Average call duration

---

## TROUBLESHOOTING COMMON ISSUES

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| Agent doesn't answer | Twilio webhook not pointing to Retell | Check Retell phone number config |
| Function calls fail | Wrong webhook URL in Retell | Update webhook URL in Retell dashboard |
| Calendar not booking | Google token expired | Re-run `node scripts/google-auth-setup.js` |
| SMS not sending | Twilio creds wrong or number unverified | Check Twilio dashboard for error codes |
| Agent sounds robotic | Voice model or speed setting | Try ElevenLabs "Rachel" at speed 1.0 |
| Long pauses during calls | Function call taking >5s | Check Google Calendar API response time; add caching |
| 401 from webhook | Wrong Retell API key | Verify `RETELL_API_KEY` in .env |
| Server crashes | Unhandled exception | Check logs; `uncaughtException` handler prevents crash but check `logs/error.log` |
