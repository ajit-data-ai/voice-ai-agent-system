# Complete Edge Case Documentation

## CATEGORY 1 — BOOKING FLOW EDGE CASES

| # | Scenario | Handling |
|---|----------|----------|
| 1.1 | Requested slot is unavailable | `checkAvailability` returns 3 alternatives; agent speaks top 3 |
| 1.2 | Calendar fully booked for next 2 weeks | System scans up to 14 days; if none found, offers callback |
| 1.3 | Race condition (2 users booking same slot) | Pre-booking re-check in `bookAppointment`; losers get error + alternatives |
| 1.4 | Patient books same appointment twice | Google Calendar event ID deduplication prevents exact duplicates |
| 1.5 | Booking too close to current time | `meetsMinAdvance()` enforces 2-hour minimum; same-day emergency bypasses this |
| 1.6 | Booking on a holiday | `clinicConfig.holidays` array checked before offering slot |
| 1.7 | Booking for a closed day (Sunday) | `clinicConfig.hours[day] === null` → day skipped entirely |
| 1.8 | Patient wants "first available ever" | System scans next 3 available days and offers earliest slot |
| 1.9 | Patient changes mind mid-booking | Agent re-asks from the "what time works?" step; no partial booking |
| 1.10 | Doctor-specific request for unavailable doctor | Returns that doctor's next available slot separately |
| 1.11 | Patient books >90 days ahead | `BOOKING_MAX_DAYS_AHEAD` env var limits how far ahead; agent apologizes + offers max |
| 1.12 | Patient gives vague time ("afternoon sometime") | `parseNaturalTime("afternoon")` returns "13:00" as starting point |
| 1.13 | Patient wants multiple services in one visit | Agent books longest service; notes both in calendar description |
| 1.14 | New patient needs 60 min but only 30 min slot exists | Duration check prevents booking; offers next 60-min slot |
| 1.15 | Patient gives wrong phone number | Agent reads it back digit-by-digit; confirms before booking |

---

## CATEGORY 2 — TECHNICAL / API EDGE CASES

| # | Scenario | Handling |
|---|----------|----------|
| 2.1 | Google Calendar API rate limit (429) | Exponential backoff: 2s, 4s, 8s — up to 3 retries |
| 2.2 | Google OAuth token expired | `getAuthClient()` uses refresh token automatically; Google SDK handles refresh |
| 2.3 | Calendar API returns empty free/busy | Treated as fully free; slots generated from business hours only |
| 2.4 | Twilio SMS delivery failure | 2 retries → fallback to email → log failure; booking still completes |
| 2.5 | Twilio error 21610 (unsubscribed number) | Marked `permanent: true`; no further SMS attempts; staff notified |
| 2.6 | Retell function call timeout (>10s) | `withTimeout(8000)` triggers before Retell's timeout; graceful fallback returned |
| 2.7 | Unknown function name called | Returns `unknown_function` error with human-friendly message |
| 2.8 | Malformed JSON from Retell | `JSON.parse` wrapped in try/catch; logs warning, doesn't crash |
| 2.9 | Server crash during active call | `uncaughtException` handler logs + exits; PM2/systemd restarts server |
| 2.10 | Concurrent calls (multiple callers at once) | Each call is stateless; no shared mutable state between requests |
| 2.11 | Invalid Retell webhook signature | Returns 401 immediately; logs warning for security monitoring |
| 2.12 | Network timeout to Google Calendar | `withRetry` handles 503; after 3 failures → graceful degradation |
| 2.13 | Database unavailable (if using DB) | In-memory fallback for callback requests; log to file |
| 2.14 | Environment variables missing | Server logs specific missing vars on startup; fails fast with clear message |
| 2.15 | Clock skew / timezone mismatch | All datetimes stored in UTC; displayed in clinic timezone using `date-fns-tz` |

---

## CATEGORY 3 — CALLER BEHAVIOR EDGE CASES

| # | Scenario | Prompt Handling |
|---|----------|-----------------|
| 3.1 | Caller completely silent | Wait 3s → prompt → wait 5s → "having trouble hearing you" → 8s → end call |
| 3.2 | Caller hangs up mid-booking | Partial data logged in post-call analysis; no incomplete booking created |
| 3.3 | Caller is extremely angry | Validate → empathize → escalate to staff. Never argue. |
| 3.4 | Caller speaks non-English | After 2 failed exchanges → transfer with reason "language_barrier" |
| 3.5 | Caller has heavy accent / bad audio | Ask politely to repeat once → if still unclear, confirm by spelling back |
| 3.6 | Caller gives wrong name spelling | Agent spells back unusual names: "Is that D-A-V-I-S?" |
| 3.7 | Caller is a child / minor | If booking, ask for parent/guardian name. Note in appointment. |
| 3.8 | Robocall / spam call | No human response after 8s → end call silently |
| 3.9 | Caller tries to get medical advice | Hard redirect: "Dr. [Name] will be best suited to advise you on that." |
| 3.10 | Caller asks for pricing guarantees | Always give ranges; "for an exact quote, Dr. X will assess at your visit" |
| 3.11 | Caller disputes a policy | "I completely understand. Let me connect you with our office manager." |
| 3.12 | Caller asks agent's name / "are you a robot?" | "I'm Sophie, the virtual receptionist for [Clinic]. I'm here to help!" |
| 3.13 | Caller tries to book for someone else | Collect the patient's name + phone (not caller's). Note "booked by [name]" |
| 3.14 | Caller provides email instead of phone | "I need a phone number to complete the booking — do you have a mobile number?" |
| 3.15 | Caller has already called 3x about same issue | No special handling (stateless); but post-call analysis flags repeated unhandled requests |

---

## CATEGORY 4 — EMERGENCY SCENARIOS

| # | Scenario | Handling |
|---|----------|----------|
| 4.1 | Knocked-out tooth | Immediate transfer (critical urgency) + staff SMS alert |
| 4.2 | Uncontrolled bleeding | Immediate transfer + "go to ER if can't reach us" |
| 4.3 | Pain 7+ out of 10 | Immediate same-day booking attempt OR transfer |
| 4.4 | Pain 4-6 out of 10 | Same-day booking attempt; if none → earliest tomorrow + OTC pain relief |
| 4.5 | Swelling / possible abscess | Transfer — this is potentially systemic; needs clinical assessment |
| 4.6 | Child in pain | Treated as high urgency regardless of stated severity |
| 4.7 | Emergency call after hours | Give emergency phone number + offer callback logging |
| 4.8 | Emergency → no same-day slots | Offer next morning first slot + emergency phone + ER guidance |
| 4.9 | Emergency transferred but staff unavailable | Log callback request automatically; send staff SMS |

---

## CATEGORY 5 — BUSINESS LOGIC EDGE CASES

| # | Scenario | Handling |
|---|----------|----------|
| 5.1 | Patient cancels < 24 hours before | Cancellation proceeds; system could flag for late-cancel policy (configurable) |
| 5.2 | Patient no-show pattern | Not tracked at agent level; EHR/CRM handles this |
| 5.3 | Insurance not accepted | Give accepted list; offer payment plan mention; don't refuse booking |
| 5.4 | Service not offered at clinic | "We don't offer that here, but we can refer you. Would a general consultation help?" |
| 5.5 | Doctor not accepting new patients | Route to next available doctor; inform patient |
| 5.6 | Clinic at max daily bookings | `max_same_day_bookings` config limits same-day; overflow goes to next day |
| 5.7 | Appointment reminder fails (SMS/email) | Log failure; does not affect the appointment itself |
| 5.8 | Intake form link broken | Fall back to: "Our team will send you the form directly before your appointment" |
| 5.9 | Holiday added after bookings made | Existing bookings not automatically cancelled; requires manual review |

---

## KNOWN LIMITATIONS (Be honest with clients)

1. **Cannot process payments** — agent takes bookings only; billing is separate
2. **Cannot access patient records** — no EHR integration in base package
3. **Cannot handle multi-party calls** — one caller at a time
4. **Cannot detect caller's emotional tone with 100% accuracy** — relies on word triggers, not true sentiment analysis
5. **Language support** — English only in base package (multilingual requires additional TTS/STT configuration)
6. **SMS delivery** — not guaranteed in areas with poor carrier coverage
7. **Calendar sync** — up to ~2 second delay in reflecting newly booked appointments (Google API cache)
