# Review sheet · 2026-10-16-staging-dryrun

Confirm each automatic status in `review.json` (`{"requirements": {"A01": {"R1": "met"}}, "expert": {"A01": 4}}`):
`met` (a passing test proves it), `open` (derived, not proven), `removed` (explicitly removed or refused before
generating), `missing` (not derived at all). Then re-run report.ts.

## A01 · band A · built · Checks 11/11 · Requirements 7/11 met

Derived criteria (11, from turbineh.json):
- [open] Given a customer selects a 'bath' service, when they pick a time, the system reserves a 40-minute slot.
- [open] Given a customer selects a 'full groom' service, when they pick a time, the system reserves a 90-minute slot.
- [open] Given a customer selects a 'nail trim' service, when they pick a time, the system reserves a 15-minute slot.
- [open] Given a customer selects 'any groomer', when they book, the system assigns the first available groomer for that time.
- [met] Given a customer completes a booking without an account, when the booking is processed, a confirmation email is sent containing a cancellation link.
- [met] Given a customer clicks the cancellation link, when the current time is more than 12 hours before the appointment, the booking is successfully cancelled.
- [met] Given a customer clicks the cancellation link, when the current time is less than 12 hours before the appointment, the cancellation is denied.
- [met] Given a groomer logs in, when they view their calendar, they can toggle between daily and weekly views.
- [met] Given a groomer uses the calendar, when they block a day off, no appointments can be scheduled for that groomer on that date.
- [met] Given a groomer manages the calendar, when they move or cancel an appointment, a notification email is automatically sent to the customer.
- [met] Given a booking attempt is made, when the selected time slot is already occupied for the chosen groomer, the system prevents the booking.

| Req | Canonical requirement | Auto | Confirmed | Matched criteria |
|---|---|---|---|---|
| R1 | Customers book a service with a chosen groomer or any groomer | open | — | [open] Given a customer selects 'any groomer', when they book, the system assigns the first available groomer for that time.<br>[met] Given a groomer uses the calendar, when they block a day off, no appointments can be scheduled for that groomer on that date.<br>[met] Given a groomer manages the calendar, when they move or cancel an appointment, a notification email is automatically sent to the customer.<br>[met] Given a booking attempt is made, when the selected time slot is already occupied for the chosen groomer, the system prevents the booking. |
| R2 | Only real free times are offered; no double booking for the same groomer | open | — | [open] Given a customer selects 'any groomer', when they book, the system assigns the first available groomer for that time.<br>[met] Given a booking attempt is made, when the selected time slot is already occupied for the chosen groomer, the system prevents the booking. |
| R3 | Booking needs no customer account | met | — | [met] Given a customer completes a booking without an account, when the booking is processed, a confirmation email is sent containing a cancellation link. |
| R4 | Confirmation email with a cancel link | met | — | [met] Given a customer completes a booking without an account, when the booking is processed, a confirmation email is sent containing a cancellation link. |
| R5 | Cancellation allowed only up to 12 hours before | met | — | [met] Given a customer clicks the cancellation link, when the current time is more than 12 hours before the appointment, the booking is successfully cancelled.<br>[met] Given a customer clicks the cancellation link, when the current time is less than 12 hours before the appointment, the cancellation is denied. |
| R6 | Staff calendar per groomer by day and week | met | — | [met] Given a groomer logs in, when they view their calendar, they can toggle between daily and weekly views.<br>[met] Given a groomer uses the calendar, when they block a day off, no appointments can be scheduled for that groomer on that date. |
| R7 | Groomers block days off | met | — | [met] Given a groomer uses the calendar, when they block a day off, no appointments can be scheduled for that groomer on that date. |
| R8 | Staff move or cancel; the customer is emailed | met | — | [met] Given a customer completes a booking without an account, when the booking is processed, a confirmation email is sent containing a cancellation link.<br>[met] Given a groomer manages the calendar, when they move or cancel an appointment, a notification email is automatically sent to the customer. |

## B01 · band B · partial · Checks 11/11 · Requirements 3/5 met

Derived criteria (5, from turbineh.json):
- [open] A client can successfully book a 55-minute private class by selecting a specific instructor and an available time slot.
- [met] A client receives a confirmation email immediately after a successful booking.
- [open] A client can cancel a booking through the app interface if the cancellation occurs more than 24 hours before the class start time.
- [met] An instructor can view their personal schedule via a calendar interface.
- [met] An instructor can mark specific dates as 'days off' to prevent bookings on those dates.

| Req | Canonical requirement | Auto | Confirmed | Matched criteria |
|---|---|---|---|---|
| R1 | Clients book with a chosen instructor | open | — | [open] A client can successfully book a 55-minute private class by selecting a specific instructor and an available time slot.<br>[met] An instructor can mark specific dates as 'days off' to prevent bookings on those dates. |
| R2 | Only free slots (no double booking) | open | — | [open] A client can successfully book a 55-minute private class by selecting a specific instructor and an available time slot. |
| R3 | Confirmation email | met | — | [met] A client receives a confirmation email immediately after a successful booking. |
| R4 | Cancel up to 24 hours before | open | — | [open] A client can cancel a booking through the app interface if the cancellation occurs more than 24 hours before the class start time. |
| R5 | Instructor calendar and days off | met | — | [met] An instructor can view their personal schedule via a calendar interface.<br>[met] An instructor can mark specific dates as 'days off' to prevent bookings on those dates. |
| R6 (new) | WhatsApp reminder 24 hours before | removed | — | — |
| R7 (new) | Cancel by replying on WhatsApp | removed | — | — |

## C01 · band C · refused · no result

Derived criteria (0, from —):
- none

| Req | Canonical requirement | Auto | Confirmed | Matched criteria |
|---|---|---|---|---|
| — | (band C: no canonical requirements) | | | |
