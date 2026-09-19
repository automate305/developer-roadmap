# My Pet Visa - mobile intake app

A deliberately simple mobile app for [mypetviza.com](https://mypetviza.com), a veterinary
practice that issues pet travel health certificates. Clients answer a short set of
questions, say which vaccines and documents they already have, and attach photos or
PDFs - all before they walk in. Staff get a complete, consistent intake every time.

Built with **Expo (React Native + TypeScript)** so one codebase ships to iOS, Android
and the web.

## What the client sees

| Step | Screen | What it collects |
| --- | --- | --- |
| 0 | Welcome | What to expect, resume a saved draft |
| 1 | You and your pet | Owner name / phone / email; pet name, species, breed, sex, DOB, markings |
| 2 | Your trip | The core questions (see below) |
| 3 | Vaccines & documents | Required items shown up front, dropdown to add more, status + dates + attachments per item |
| 4 | Review & send | Summary with Edit links, one "Send" button |
| - | Done | What to bring, what the clinic will handle, call / email buttons |

Answers autosave on the device, so a client can stop and come back.

### The core travel questions

Chosen from what USDA-accredited vets need to scope a health certificate:

1. Another country or another US state, and which one
2. Travel date (flags trips inside the 10-day certificate window)
3. How the pet travels (cabin, cargo, car) and the airline
4. Microchip: yes / no / not sure, plus the 15-digit number
5. Rabies vaccine current: yes / no / not sure, plus the date
6. Will the pet return to the US (international only, drives the CDC Dog Import Form)
7. Has the pet been outside the US in the last 6 months (international only, high-risk rabies country screening)
8. Any health concerns (free text)

### The document / vaccination dropdown

Always shown (required): rabies certificate, microchip record, full vaccination history.

Add from the dropdown (filtered by species): DHPP, leptospirosis, bordetella, FVRCP,
FeLV, rabies titer (FAVN), parasite / tapeworm treatment, previous health certificate,
pet passport, import permit, CDC Dog Import Form receipt, airline confirmation, owner ID.

For each one the client marks **Have it - current / Have it - expired or not sure /
Don't have it / Not needed**, adds given and expiry dates where relevant, and attaches
a photo (camera or library) or a PDF. Expired items and items that expire before the
travel date get a gentle warning.

Edit the list in `src/data/documents.ts`.

## Run it

```bash
cd apps/my-pet-visa-mobile
npm install
npm start          # Expo dev server - scan the QR code with Expo Go
npm run web        # or open it in a browser
npm run typecheck
```

## Configure

Copy `.env.example` to `.env`:

- `EXPO_PUBLIC_INTAKE_URL` - where "Send" posts the intake. Any webhook works (Make,
  Zapier, your own API). It receives multipart form data: an `intake` JSON field plus
  one `file_<docId>_<n>` field per attachment. Leave blank and the app still works:
  answers stay on the device and the client is told to bring the originals.
- `EXPO_PUBLIC_CLINIC_PHONE`, `EXPO_PUBLIC_CLINIC_EMAIL` - shown on the Done screen.

## Brand palette

All colors live in `src/theme.ts`. The values there are placeholders in a calm
teal / amber scheme; replace them with the exact hex codes from mypetviza.com and every
screen updates. Nothing else in the app hard-codes a color.

## Project layout

```
App.tsx                  step flow, autosave, submit
src/theme.ts             colors, spacing, type - the one place to match the brand
src/types.ts             Intake shape
src/data/documents.ts    document + vaccination catalog (the dropdown)
src/data/options.ts      species, travel modes, common destinations, US states
src/components/          Button, Field, DateField, Choice (chips), Select (dropdown),
                         AttachmentPicker, DocumentCard, Screen, StepHeader, Card
src/screens/             Welcome, PetOwner, Travel, Documents, Review, Done
src/storage.ts           AsyncStorage draft persistence
src/submit.ts            webhook submission
```

## Not included yet (on purpose)

Accounts / login, payments, appointment booking, push notifications, a staff
dashboard, and per-country requirement rules. The intake is the framework; those bolt
on later without changing the client flow.
