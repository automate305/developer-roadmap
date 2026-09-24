# PetViza intake - pilot wiring guide

How to take the app in this folder from "runs on a laptop" to "live on mypetviza.com
with submissions landing in the coordinator's inbox." Three pieces: a place for
submissions to go, a place to host the app, and the private link that connects the
site's consultation form to the app.

Nothing here requires accounts or passwords for clients. The private link is the
"portal."

---

## 1. Where submissions go (Make webhook)

The app POSTs `multipart/form-data` to `EXPO_PUBLIC_INTAKE_URL`. Any webhook that
accepts multipart works; Make is the fastest for a pilot.

### What the app sends

Flat fields (so Make can route on them without parsing JSON):

| Field | Example |
| --- | --- |
| `leadRef` | `LEAD-1042` (from the private link, may be empty) |
| `ownerName` | `Ana Ruiz` |
| `ownerEmail` | `ana@example.com` |
| `petName` | `Luna` |
| `destination` | `Colombia` |
| `travelDate` | `12/15/2026` |
| `intake` | The full intake as a JSON string (everything above plus species, breed, microchip, rabies, answers to every question, per-document status/dates/notes, `lang`, `source: "petviza-intake"`) |

Files, one field per attachment: `file_<docId>_<n>`, e.g. `file_rabies_certificate_1`,
`file_microchip_record_1`, `file_vaccine_history_2`. Make exposes each as a file
collection with `name`, `mime` and `data`.

### Scenario: "PetViza intake received"

1. **Webhooks > Custom webhook.** Create it, copy the URL. That URL is
   `EXPO_PUBLIC_INTAKE_URL`. Send one test submission from the app so Make learns the
   structure (Make's "Redetermine data structure" button).
2. **Google Drive > Create a folder** in the shared PetViza Drive, name it
   `{{travelDate}} - {{ownerName}} - {{petName}}`.
3. **Iterator** over the file fields. In the iterator's array field use Make's
   `toArray()` on the webhook bundle filtered to keys starting with `file_`, or simply
   add one **Google Drive > Upload a file** module per essential document
   (`file_rabies_certificate_1`, `file_microchip_record_1`, `file_vaccine_history_1`)
   plus a generic iterator for the rest. For a pilot, the three explicit uploads are
   enough.
4. **Google Sheets > Add a row** to an "Intakes" sheet: timestamp, leadRef, owner,
   email, phone, pet, species, destination, travel date, days until travel, rabies
   status, microchip status, folder link, language.
5. **Gmail / Email > Send** to the coordinator:
   subject `New intake: {{petName}} to {{destination}} on {{travelDate}}`, body with the
   summary and the Drive folder link. Optionally a second email to the client
   confirming receipt (in their language: check `intake.lang`).
6. Optional: **HubSpot > Create/Update contact** using `ownerEmail`, and attach the
   folder link as a note. You already have HubSpot connected.

Set the webhook's max file size to 25 MB. Phone photos are 2-5 MB each.

### If you would rather use Supabase

A table `intakes` (jsonb `payload`, text `lead_ref`, text `owner_email`, text `status`)
plus a storage bucket `intake-files` and an Edge Function that accepts the same
multipart POST. Same app, different URL. Better home once there is a status page
(Phase 2), overkill for a five-client pilot.

---

## 2. Hosting the app on the domain

The app exports to a static web bundle. It can live anywhere that serves static
files; Vercel is already in use for the site.

```bash
cd apps/my-pet-visa-mobile
cp .env.example .env            # set EXPO_PUBLIC_INTAKE_URL and contact details
npm install
npx expo export --platform web  # writes ./dist
```

Deploy `dist/` as its own Vercel project (framework: Other, output directory `dist`,
build command `npx expo export --platform web`, root directory
`apps/my-pet-visa-mobile`). Then either:

- **Subdomain** `start.mypetviza.com`: add the domain to the Vercel project and one
  CNAME record at GoDaddy. Cleanest separation from the marketing site.
- **Path** `mypetviza.com/start`: add a rewrite in the marketing site's `vercel.json`
  from `/start/(.*)` to the app project's URL. Keeps one domain; slightly more config.

Recommendation for the pilot: subdomain. It ships in ten minutes and the marketing site
is untouched.

Native iOS/Android builds are not needed for the pilot. When they are, `eas build`
uses the same code and `app.json` already carries the bundle identifiers, splash and
icon.

---

## 3. The private link

The site's consultation modal already collects first/last name, email, phone,
destination country, departure date and "pet name, species, age". It posts to an
internal `/api/lead` endpoint.

Wherever that lead lands (inbox, sheet, HubSpot), the automation that handles it
should build a link like:

```
https://start.mypetviza.com/?ref=LEAD-1042&name=Ana%20Ruiz&email=ana%40example.com
  &phone=3055550123&pet=Luna&species=dog&to=Colombia&date=2026-12-15&lang=es
```

and send it to the client after the consultation call ("Here is your private PetViza
link - it takes about five minutes"). Every parameter is optional:

| Param | Values | Notes |
| --- | --- | --- |
| `ref` | any string | Echoed back as `leadRef` so submissions match the lead |
| `name`, `email`, `phone`, `pet` | text | Phone digits only or formatted, both fine |
| `species` | `dog`, `cat`, `other` | |
| `to` | country name | Sets travel type to international |
| `type` | `intl` or `us` | Only needed for domestic trips |
| `date` | `YYYY-MM-DD` or `MM/DD/YYYY` | |
| `lang` | `en` or `es` | Opens the app in that language |

The app fills only the fields the client has not typed into yet, so reopening the
link never wipes their edits, and it shows a "We started this for you, Ana" note on
the welcome screen.

Building the link in Make is one **Tools > Set variable** with `encodeURL()` around
each value.

---

## 4. Pilot checklist

- [ ] Real clinic phone and email set in `.env` (site currently shows placeholders)
- [ ] Confirm copy: "coordinator" (concierge) vs "your appointment" (clinic)
- [ ] Make scenario live, one end-to-end test with a real photo from an iPhone
- [ ] App deployed to `start.mypetviza.com`
- [ ] Lead automation sends the private link after the consult call
- [ ] Five to ten real clients through the flow
- [ ] Measure: completion rate, coordinator minutes saved per intake

---

## 5. Test on a real phone

```bash
npm start            # Expo dev server
```

Scan the QR with Expo Go for native, or open the LAN URL in Safari/Chrome on the phone
for the web version (the one the pilot uses). On mobile web, "Take photo" opens the
camera sheet directly.

To test the private link locally:

```
http://<your-laptop-ip>:8081/?name=Ana%20Ruiz&email=ana%40example.com&pet=Luna&species=dog&to=Colombia&date=2026-12-15&lang=es
```
