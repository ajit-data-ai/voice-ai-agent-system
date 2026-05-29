# 🎙️ Voice AI Agent System

Production-grade AI phone agent system. Handles inbound/outbound calls, appointment booking, lead qualification, and emergency routing — built on Retell AI + Google Calendar + Twilio.

---

## What's Included

```
voice-ai-agent-system/
├── server.js                          ← Main Express server (start here)
├── .env.example                       ← All env vars documented
├── config/
│   ├── agent-config.json              ← Retell agent config + all function schemas
│   └── clinic-config.json             ← Client config template (copy per client)
├── agents/
│   ├── dental/system-prompt.txt       ← Production dental agent prompt (12 flows, 50+ edge cases)
│   └── real-estate/system-prompt.txt  ← Real estate lead qualification prompt
├── functions/
│   ├── calendar.js                    ← Google Calendar (check/book/reschedule/cancel)
│   ├── sms.js                         ← Twilio SMS (confirmations, reminders, alerts)
│   └── appointments.js                ← Orchestration layer (booking + notifications)
├── webhooks/
│   └── retell-webhook.js              ← Retell POST webhook + LLM WebSocket handler
├── monitoring/
│   └── health-check.js                ← /health + /ping endpoints
├── utils/
│   ├── logger.js                      ← Winston structured logging
│   └── date-helpers.js                ← Natural language date/time parsing
├── docs/
│   ├── EDGE-CASES.md                  ← 50+ edge cases documented + handled
│   ├── DEPLOYMENT.md                  ← Full deployment guide (local → production)
│   └── CLIENT-ONBOARDING.md           ← Per-client setup SOP + monthly maintenance
└── tests/
    └── scenarios.md                   ← 24 test scenarios + pre-launch checklist
```

---

## Quick Start

```bash
npm install
cp .env.example .env
# Fill in .env

npm run dev
# In another terminal:
npx ngrok http 3000
# Use ngrok URL as webhook in Retell dashboard
```

---

## Supported Verticals

| Vertical | Template | Flows |
|----------|----------|-------|
| Dental Clinic | `agents/dental/` | Book, Reschedule, Cancel, FAQ, Emergency, Transfer |
| Real Estate | `agents/real-estate/` | Lead Qualify, Showing Booking, Discovery Call |
| More coming | `agents/[vertical]/` | Extensible |

---

## Per-Client Deployment

1. Copy `config/clinic-config.json` → fill in client details
2. Customize system prompt variables
3. Google Calendar OAuth (one-time per client)
4. Create Retell agent, paste prompt + functions
5. Buy Twilio number → assign to Retell agent
6. Run full test suite (`tests/scenarios.md`)
7. Go live

See `docs/CLIENT-ONBOARDING.md` for full step-by-step SOP.

---

## Tech Stack

- **Retell AI** — Voice orchestration, LLM, TTS/STT
- **Node.js + Express** — Webhook server
- **Google Calendar API** — Appointment scheduling
- **Twilio** — SMS confirmations + phone numbers
- **date-fns** — Timezone-safe date handling
- **Winston** — Structured logging

---

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Stateless webhook handlers | Each call is independent — no shared state between concurrent calls |
| Pre-booking re-check | Prevents race conditions when 2 callers book the same slot simultaneously |
| Graceful function timeouts | 8s timeout prevents Retell's 10s hard timeout from crashing the call |
| Cancel = soft delete | Calendar events are marked [CANCELLED] not deleted — preserves history |
| SMS errors non-fatal | A failed SMS should never break a booking — logged silently |
| Exponential backoff on API | Handles Google/Twilio rate limits without failing the call |
