# Client Onboarding SOP
## Time to complete: 2–4 hours | Billable: Setup fee ($500–$1,000)

---

## INFORMATION TO COLLECT FROM CLIENT (Before you start)

Send them this form / ask on a call:

```
CLINIC INFORMATION FORM

1. Clinic name (official):
2. Address (full):
3. Main phone number:
4. Emergency/after-hours phone:
5. Email address:
6. Website:
7. Timezone:

HOURS OF OPERATION (open/close or "closed"):
   Monday:
   Tuesday:
   Wednesday:
   Thursday:
   Friday:
   Saturday:
   Sunday:

SERVICES OFFERED (list all + approximate duration):
   1.
   2.
   3.

DOCTORS / PROVIDERS:
   Name 1, specialty, email (for calendar):
   Name 2, specialty, email (for calendar):

INSURANCE ACCEPTED:

BOOKING RULES:
   Minimum notice required (hours):
   How far ahead can patients book (days):
   Appointment slot intervals (30 or 60 min):

STAFF NOTIFICATIONS:
   Staff SMS for urgent calls:
   Staff email for new patients:

WHAT THE AI AGENT SHOULD NEVER SAY/DO:
   (Client-specific restrictions)

GOOGLE ACCOUNT EMAIL (for calendar access):
```

---

## SETUP STEPS

### Step 1: Config File (30 min)
- Copy `config/clinic-config.json` → `config/clients/[client-slug].json`
- Fill every field using the client's form responses
- Pay special attention to:
  - `hours` — exact open/close times per day
  - `holidays` — add next 12 months of holidays
  - `escalation.transfer_triggers` — any client-specific phrases
  - `booking.min_advance_hours` — how far ahead they require bookings

### Step 2: System Prompt Customization (45 min)
- Copy `agents/dental/system-prompt.txt` → `agents/clients/[client-slug]-prompt.txt`
- Replace all `{{VARIABLE}}` placeholders with actual values
- Update the FAQ section with their real policies
- Add client-specific knowledge (e.g., parking, accessibility, special policies)
- Remove services not offered

### Step 3: Google Calendar OAuth (15 min)
- Log in as the client's Google account (they share credentials temporarily)
- Run: `node scripts/google-auth-setup.js`
- Save the refresh token → add to client's `.env` section
- Test: `node scripts/test-calendar.js` — should list their calendar

### Step 4: Retell Agent Creation (20 min)
- Log in to Retell dashboard
- Create new agent → name it "[Client Name] AI Receptionist"
- Paste the customized system prompt
- Add all functions from `config/agent-config.json`
- Set voice (recommend: ElevenLabs Rachel for female, Adam for male)
- Set begin message using client's clinic name
- Save Agent ID

### Step 5: Phone Number Setup (15 min)
- In Retell: Phone Numbers → Import or Create
- Choose area code matching client's city
- Assign to the new agent
- Forward calls: client's website or Google Business profile can list this number

### Step 6: Environment Variables (10 min)
Update `.env` for this client's deployment:
```
CLINIC_NAME=
CLINIC_PHONE=
CLINIC_TIMEZONE=
TWILIO_PHONE_NUMBER=
GOOGLE_CALENDAR_ID=
GOOGLE_REFRESH_TOKEN=
STAFF_NOTIFICATION_PHONE=
STAFF_NOTIFICATION_EMAIL=
RETELL_AGENT_ID=
```

### Step 7: Full Test Run (45 min)
Run every test in `tests/scenarios.md`. No exceptions.
- T1–T6: Happy path bookings ✅
- T7–T15: Edge cases ✅
- T16–T20: Information accuracy ✅

Call the agent 10 times in different scenarios. Fix any issues.

### Step 8: Client Demo + Handover (30 min)
- Screen share while you call the agent live
- Walk them through what they'll see in Google Calendar
- Show them where to check SMS logs (Twilio dashboard)
- Set up UptimeRobot health monitoring (send them the status page link)
- Hand over: Twilio number, how to update hours/services (via you)

---

## MONTHLY MAINTENANCE CHECKLIST

Run this every month for each client:

```
[ ] Check call volume (Retell dashboard analytics)
[ ] Review failed/transferred calls — any patterns?
[ ] Check for any unhandled_request flags in post-call analysis
[ ] Update holiday calendar for next 30 days
[ ] Verify Google Calendar OAuth still active
[ ] Test one sample call
[ ] Send client monthly report:
    - Total calls handled
    - Appointments booked by AI
    - Appointments transferred to staff
    - Most common call reason
    - Any issues identified
```

---

## MONTHLY REPORT TEMPLATE

```
MONTHLY AI RECEPTIONIST REPORT
[Month Year] | [Clinic Name]

📞 CALL SUMMARY
Total calls handled:         [X]
Avg call duration:           [X] seconds

📅 BOOKINGS
Appointments booked by AI:   [X]
Appointments rescheduled:    [X]
Appointments cancelled:      [X]

🔄 TRANSFERS
Transferred to staff:        [X]
  - Emergency:               [X]
  - Caller requested human:  [X]
  - Other:                   [X]

⚠️ FLAGS
Failed bookings:             [X]
Unhandled requests:          [X]

💬 COMMON CALL REASONS
1. [Reason] — [X]%
2. [Reason] — [X]%
3. [Reason] — [X]%

✅ SYSTEM HEALTH
Uptime:                      [X]%
SMS delivery rate:           [X]%
Calendar sync:               OK

NEXT MONTH ACTIONS:
[Any updates needed]
```
