# Complete Test Scenarios — Run Before Every Client Deployment

## HOW TO TEST
1. Call your Twilio number directly
2. Role-play each scenario below
3. Check calendar after booking tests
4. Check SMS delivery
5. Mark PASS/FAIL

---

## TEST SET 1 — HAPPY PATH (Must all pass)

| # | Script to say | Expected agent behavior | Calendar created? | SMS sent? |
|---|---------------|------------------------|-------------------|-----------|
| T1 | "Hi, I'd like to book a cleaning" | Asks new/returning, then collects info, checks availability, books | ✅ Yes | ✅ Yes |
| T2 | "I need to reschedule my appointment on Thursday" | Asks name + phone, looks it up, offers alternatives | ✅ Updated | ✅ Yes |
| T3 | "I want to cancel my appointment" | Asks for name/date, offers reschedule first, then cancels on confirmation | ✅ Cancelled | ✅ Yes |
| T4 | "What are your hours?" | Speaks hours accurately | N/A | N/A |
| T5 | "Do you accept Delta Dental?" | "Yes, we accept Delta Dental" | N/A | N/A |
| T6 | "I'm a new patient, I need a checkup" | Books consultation, sends intake form SMS | ✅ Yes | ✅ Intake form |

---

## TEST SET 2 — EDGE CASES (Critical)

| # | Script to say | Expected agent behavior |
|---|---------------|------------------------|
| T7 | [Say nothing after greeting] | Prompts after 3s, ends call after 8s |
| T8 | "I have a toothache, it's really painful, like 8 out of 10" | Immediately offers transfer or same-day emergency slot |
| T9 | "I knocked out my tooth!" | Immediate transfer, critical urgency |
| T10 | "I want to speak to a human" | Transfers immediately, no hesitation |
| T11 | "This is ridiculous, I've been waiting forever!" | Empathizes, does NOT argue, transfers to manager |
| T12 | "Can you book for December 31, 2099?" | Politely declines, gives max booking window |
| T13 | "Book me for tomorrow at 7am" | Explains clinic opens at [time], offers first available |
| T14 | "My name is Aaaaaaa Bbbbbbb" (unusual name) | Spells back to confirm |
| T15 | [Call after hours] | Announces closed, gives emergency number, offers callback |

---

## TEST SET 3 — INFORMATION ACCURACY

| # | Script to say | Expected agent behavior |
|---|---------------|------------------------|
| T16 | "How much does a root canal cost?" | Gives price range, says "for exact quote Dr. will advise" |
| T17 | "Do you take Medicaid?" | "We don't currently accept Medicaid, but we accept [list]" |
| T18 | "What should I bring to my appointment?" | Lists ID, insurance card, dental records |
| T19 | "Are you a robot?" | "I'm Sophie, the virtual receptionist!" — doesn't deny being AI |
| T20 | "What's the WiFi password?" | "I'm not sure about that one! Our team can help when you arrive." |

---

## TEST SET 4 — FAILURE MODES (Simulate by temporarily breaking integrations)

| # | How to simulate | Expected behavior |
|---|----------------|-------------------|
| T21 | Set wrong Google credentials | Agent says "having trouble with calendar, let me take your details and have team confirm" |
| T22 | Disable Twilio in dashboard | Booking still completes; SMS failure logged silently |
| T23 | Kill the server mid-call | Call drops; no partial booking in calendar |
| T24 | Send request without Retell signature | Server returns 401; no data processed |

---

## PERFORMANCE BENCHMARKS

| Metric | Acceptable | Target |
|--------|-----------|--------|
| Agent first word latency | < 800ms | < 500ms |
| Function call response time | < 8s | < 3s |
| Calendar booking end-to-end | < 10s | < 5s |
| SMS delivery | < 30s | < 10s |
| Successful booking rate (happy path) | > 90% | > 97% |

---

## PRE-LAUNCH CHECKLIST

- [ ] All T1–T6 tests pass
- [ ] T7 (silence) test passes
- [ ] T8, T9 emergency tests pass
- [ ] Twilio number registered and configured
- [ ] Google Calendar shows booked test events
- [ ] SMS received for all booking tests
- [ ] After-hours message tested
- [ ] Staff alert SMS tested (for emergencies)
- [ ] Health check endpoint returns 200
- [ ] All environment variables set
- [ ] Server running with PM2 (auto-restart on crash)
- [ ] Webhook URL registered in Retell dashboard
- [ ] SSL certificate valid (ngrok or production)
