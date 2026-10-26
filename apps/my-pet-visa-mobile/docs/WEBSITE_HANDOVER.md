# PetViza website handover

Contact fix, intake, webhook, and chatbot upgrade

You are a senior full-stack engineer working inside the PetViza website project. This file is your complete brief. Read all of it before you change anything.

| | |
| --- | --- |
| Live site | mypetviza.com, Vercel project `petviza-demo` |
| Requested by | Cam (Automate305), building this for his client PetViza |
| Spelling rule | PetViza, mypetviza.com, hello@mypetviza.com. Always with a Z. If any instruction you received says "visa" or "music", it is a dictation error. |

## 0. How to work

1. Read this whole file first.
2. Do Phase 0 (read-only audit) before touching anything.
3. Ship Phase 1 on its own. It is small and urgent.
4. Build Phases 2 and 3 together behind the `INTAKE_ENABLED` flag. The intake must not be visible in production until Phase 3 passes its end-to-end test.
5. Phase 4 (chatbot) is a separate release.
6. Where you see **STOP AND ASK CAM**, stop and ask. Do not guess.
7. Work on a branch. Deploy to a Vercel preview first. Promote only after that phase's checks pass.
8. After each phase, post the report described in section 11.

## 1. Goal

PetViza is a pet travel concierge. It coordinates the vet work and government steps for international pet travel. It is not a veterinary clinic. Never write copy that says or implies otherwise.

A visitor should understand within seconds what PetViza will ask for and what to have ready. The hero gets a smaller headline and a short "start here" card. The next section holds the full intake: five questions, a drag-and-drop area for documents, contact details, and a consultation request. One submission must:

- email the coordinator at hello@mypetviza.com
- add one row to a Google Sheet that Cam controls
- file the uploaded documents, as PDFs, in a Google Drive folder for that case
- send the visitor a short confirmation email

The business owner is not technical. Everything she touches must be an email, a Google Sheet, or a Drive folder. No dashboards, no logins, no status tracking. The service is white glove, and she specifically does not want clients chasing for status.

## 2. What already exists (audited from the live site; verify in Phase 0)

**Stack.** Plain HTML with inline CSS and vanilla JS, plus `chatbot.js`, `chatbot.css`, and one Vercel serverless function at `api/lead.js`. It started in Lovable and was rebuilt by hand with coding agents. Do not migrate to a framework.

**Hero.** `section.hero` holds `.hero-circle-1`, `.hero-circle-2`, and `.pv-shell.hero-grid`.
- Left column: eyebrow "International travel, made human", `h1.hero-title` ("Go farther. Worry less."), `.hero-subtitle`, `.hero-actions`, and `.hero-trust`.
- `.hero-cta` "Get your travel plan" calls `openModal()`. `.hero-link` "See how it works" calls `smoothScroll('process')`.
- Right column `.hero-visual`: `.hero-card-main` ("Case file / 026", "A clear path to anywhere.") and `.hero-card-small` ("Ready to fly", "Certificate packet reviewed").
- Below the grid: `.hero-bar` ("Medical clarity / Government-ready / Calm, start to finish").

**Sections by id.** `#process`, `#expertise`, `#faq`, `#contact`.

**Forms.** A consultation modal `#consultModal` (`openModal()`, `closeModal()`) and a contact-section form share the same fields: first name, last name, email, phone, destination ("Where are you going?"), departure date, preferred consultation time, "Tell us about your pet", optional message, consent checkbox, and hidden fields including `timezone`, `source`, and a field named `website` that is probably a honeypot. Keep it.

**Submit.** `submitForm(e, containerId)` builds JSON from FormData, adds `timezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone` and `consultationDateTimeUtc` from `new Date(consultationDateTime).toISOString()`, then POSTs to `/api/lead`.

**Lead function.** `api/lead.js` sanitizes input and requires: `firstName`, `lastName`, `email`, `phone`, `destination`, `departureDate` (10 chars, YYYY-MM-DD), `consultationDateTime`, `consultationDateTimeUtc`, `timezone`, `consent`. Optional: `petDetails` (500), `message` (2000), `source` (50), `transcript` (last 20 chat turns). The preview I could read stops before the delivery code, so read the whole file. The chatbot handles a `demo` flag in the response ("No email or calendar event was created. The live Google webhook will activate those steps"), which suggests the function runs in demo mode with nothing configured. Cam confirms leads currently land nowhere.

**Chatbot.** Panel `#pvChatPanel`, launcher `#pvChatLauncher`, messages `#pvChatMessages`, quick replies, composer `#pvChatComposer` (input `#pvChatInput`, 500 chars), lead form `#pvChatLeadForm`. `chatbot.js` is a starter: a keyword matcher (`mockIntent`) picks one of six canned replies and appends a link to the USDA APHIS export page. It answers after 250 ms. There is no LLM and no retrieval. Its success message says "We emailed your confirmation, and Daniela received your consultation request", which is not true until Phase 3 is live.

**Contact details today.** `petvizatraveling@gmail.com` appears twice in `index.html` and once in `chatbot.js` (an error message). No phone number is shown. The input placeholders `+1 305 555 0123` and `you@example.com` are placeholders, not contact details.

**Brand tokens (use the existing CSS variables, do not add new colors or fonts).**

| Token | HSL | Hex |
| --- | --- | --- |
| `--primary` | 215 57% 15% | #10233C |
| `--secondary` | 214 48% 86% | #CAD9EC |
| `--muted` | 214 32% 95% | #EEF2F6 |
| `--muted-foreground` | 215 21% 42% | #556782 |
| `--border` | 214 28% 84% | #CBD5E2 |
| `--accent` | 2 76% 76% | #F09693 |
| `--destructive` | 4 68% 47% | #C93126 |

Radius `.35rem`. Fonts: DM Sans for body, Space Grotesk for display. Logo blues: #1070B0 and #003870. Existing helper classes: `pv-shell`, `pv-eyebrow`, `pv-display`, `pv-button`, `pv-reveal`.

**Deploy facts.** Production is Vercel project `petviza-demo` with domains mypetviza.com and www.mypetviza.com. The current production deployment is `petviza-demo-53t8lph7r-cam-automate305.vercel.app` (id `dpl_3pLKDmFZC6Ud7DJhNjoJ9rUAJqMn`). It is a rollback candidate. A second project named `petviza` is unused and its last deploy failed. Do not deploy there.

## 3. Hard rules (non-negotiable)

1. **Never lose a lead.** Show success only after the webhook confirms. On failure, keep everything the visitor typed, retry once automatically, then show a clear message with the hello@ address. Log every failure without personal data.
2. **One source of truth for contact details.** A single `SITE` config block. No hard-coded emails anywhere else.
3. **No fake contact details.** Show no phone number until Cam supplies one.
4. **No framework migration.** Keep plain HTML, CSS, vanilla JS, and Vercel functions. Keep the existing variables, classes, and fonts.
5. **Nothing existing breaks.** The modal form, the contact form, and the chatbot keep working. `/api/lead` stays backward compatible: old payloads still validate.
6. **Privacy.** Consent checkbox unchecked by default. Store the consent version and UTC time. Link `/privacy` from every consent line. Store files privately. No owner passport or ID upload on the public form. Delete staged files once they are filed in Drive.
7. **Security.** Validate everything on the server. Keep the honeypot. Rate limit every public endpoint. No secrets in client code or git. Protect the webhook with a shared secret. Restrict files by type and size on the server. No personal data or file contents in logs.
8. **Files never pass through a function body.** Vercel rejects request bodies over about 4.5 MB. Upload directly to storage.
9. **Mobile first.** Test on real iPhone Safari and Android Chrome. Inputs at least 16px. Tap targets at least 44px. "Take photo" opens the camera.
10. **Accessible.** Real labels, keyboard operable, visible focus, AA contrast, errors announced, `prefers-reduced-motion` respected.
11. **Honest copy.** The consultation time is a request. The coordinator confirms by email. Never claim a booking, a timeline guarantee, or an outcome. Requirements vary by destination and PetViza confirms them personally.
12. **Rollback ready.** Before your first change, note the current production deployment and keep it promotable.
13. **Everything in version control.** If the live source is not in a git repo, stop and fix that first.
14. **English first, Spanish later.** Keep user-facing strings in one object per feature so translation is a later swap. Accept `?lang=es`, store it with the lead, and do not translate yet.
15. **Case ID on every submission.** `PV-` plus 8 random characters from an unambiguous alphabet (no 0/O, 1/I/L). It appears in emails, the Sheet, the Drive folder name, and the success screen. The future client portal will key off it.
16. **Email must land in inboxes.** Mail comes from the hello@ mailbox. SPF, DKIM, and DMARC must pass for the sending path. Test with Gmail, Outlook, and iCloud.

## 4. Phase 0: audit and safety net (read-only)

1. Find the real source for the live site. Confirm it is in git and matches production (compare `index.html` with the live page). If it is not in version control, **STOP AND ASK CAM** which repo to use.
2. Read `api/lead.js`, `chatbot.js`, and the inline script in `index.html` in full.
3. Report: the environment variable names `lead.js` expects, what it does when they are set, what it returns, and whether it is in demo mode today.
4. Confirm the site runs locally and a Vercel preview deploy works.
5. Note the rollback deployment from section 2.

Continue unless something contradicts this file. If it does, report the contradiction and ask.

## 5. Phase 1: contact fix and privacy notice (ship first)

1. Add one config block and render every contact detail from it:
   ```js
   const SITE = { email: 'hello@mypetviza.com', phone: '', coordinator: 'Daniela' };
   ```
   When `phone` is empty, render nothing: no "call us" text and no `tel:` link.
2. Replace every `petvizatraveling@gmail.com`. Search the whole project, including `chatbot.js`, `api/lead.js`, meta tags, JSON-LD, footers, and success and error messages. Keep `mailto:` links working with the subject prefilled to "PetViza inquiry".
3. Create `/privacy` from Appendix C. Link it from the footer, every consent line, and the chat panel. Mark it as a draft pending review by the client.
4. Acceptance: a search for `petvizatraveling` returns nothing. The hello@ address appears in the footer, the contact section, and the chat error message. `/privacy` loads.

**STOP AND ASK CAM** before the production deploy: confirm that hello@mypetviza.com actually receives mail. A visitor who emails a dead address is a lost lead.

## 6. Phase 2: hero card and intake section

### 6.1 Hero changes

- Shrink `h1.hero-title` to about two thirds of its current size. Keep two lines and the accent span. Reduce the hero top padding so the card is visible without scrolling on a 1280x720 laptop and, on a phone, within the first screen after the subtitle.
- The left column keeps the eyebrow, headline, subtitle, and trust row. Change the primary button to "Start your route" and make it scroll to `#intake`. Keep "See how it works".
- Replace the contents of `.hero-visual` with the start card below. Remove `.hero-card-main` and `.hero-card-small` from the hero. Reuse their look (navy surface, eyebrow style, "Case file" label) for the card header so it still feels like the brand.
- On mobile, stack: headline, subtitle, card, trust row. Drop the decorative circles if they hurt legibility or performance.
- Keep `.hero-bar`.

### 6.2 The start card

- Eyebrow `New case file`. Title `Start your route`. Sub `Three quick questions. About two minutes.`
- Field 1, **Where is your pet going?** A combobox with these quick picks plus free text: Colombia, Mexico, Dominican Republic, Spain, Venezuela, Brazil, Argentina, Peru, Ecuador, Chile, Costa Rica, Panama, Canada, United Kingdom, France, Italy, Germany, Portugal, Israel, United Arab Emirates, Japan, Australia, Puerto Rico, Hawaii.
- Field 2, **When do you leave?** Native date input, minimum today.
- Field 3, **Your pet.** Name, plus Dog / Cat / Other as large buttons.
- Button `Continue`. It saves the values to `localStorage` under `petviza.intake.v1`, scrolls to `#intake`, pre-fills it, and focuses the first empty field.
- Card footer, "Have ready": rabies certificate, microchip record, vaccination history. Then: "No commitment. We confirm every requirement with you personally."
- Short-notice message, thresholds as constants. Under six weeks: "Sooner than our usual window? That's okay. Tell us the date and we start with a fast review." Under ten days, add: "Choose the earliest call time below."

### 6.3 The intake section

Insert `<section id="intake">` directly after the hero and before `#process`. Use the existing section styling.

Desktop layout is two columns. Left, sticky: the heading "What we'll ask, and what to have ready", the five questions as a numbered list with one-line reasons (Appendix A), the three documents with descriptions, and a privacy reassurance. Right: the form as four numbered cards, all visible on one page. Mobile stacks them with the list first.

1. **Your route.** Destination and departure date, prefilled from the hero card.
2. **Your pet.** Name, species, breed, age or birth date.
3. **Health records.** Microchip: yes, no, or not sure, plus the 15-digit number if yes and the implant date (optional). Rabies vaccine current: yes, no, or not sure, plus the date given and the expiry date. Then the document drop zone (6.4).
4. **You and your call.** First name, last name, email, phone, preferred consultation date and time (local time), optional message, consent with the privacy link, and the submit button "Request my consultation".

The five questions are: route, departure date, pet, microchip, rabies. Required fields: everything `api/lead.js` already requires, plus pet name, species, and an answer (yes, no, or not sure) for microchip and for rabies. Documents are optional. "Not sure" is always an acceptable answer.

### 6.4 Document drop zone

- Slots, each with a label, a one-line description, and a status tick once filled: Rabies vaccination certificate, Microchip record, Full vaccination history, and Anything else (optional, multiple). Copy is in Appendix A.
- Each slot accepts drag and drop, tap to choose, and on mobile a "Take photo" button (`accept="image/*,application/pdf"`, with a separate input using `capture="environment"`). Each slot also has an "I don't have this yet" toggle. No slot blocks submission.
- Accepted: PDF, JPG, PNG, HEIC, HEIF. Anything else gets a plain-English error.
- **Photos become PDFs automatically.** Convert in the browser. Resize to about 1600 px on the long edge, JPEG quality around 0.8, one image per PDF page. Several photos in one slot merge into a single multi-page PDF, with reorder and remove controls. PDFs pass through unchanged. Load the PDF library lazily, only when the first image is added.
- iPhone photos may arrive as HEIC. Either rely on Safari's automatic conversion or convert with a lazily loaded library. Test with a real iPhone.
- File names: `{Slot label} - {Pet name}.pdf` in Drive. Storage paths use the case ID only: `cases/{caseId}/{slot}-{n}.pdf`. No personal data in storage paths.
- Limits: 10 MB per PDF after conversion, 6 files in "Anything else", 30 MB total. Friendly errors that say what to do.
- Show a thumbnail or PDF icon, name, size, and Replace and Remove buttons.
- Upload at submit time, not at selection, so abandoned forms leave no files behind. Show per-file progress and allow retry without re-entering anything.
- Microcopy under the zone: "Your files travel over an encrypted connection, are stored privately, and only the PetViza team sees them."

### 6.5 Validation and behavior

- Inline validation on blur and on submit, with errors announced to screen readers.
- US-first phone mask that still accepts a leading `+` for international numbers.
- Autosave the draft (never the files) to `localStorage` and clear it after a successful submit. Warn before leaving the page only when files are attached and unsent.
- Disable the submit button while sending and prevent double submits.

### 6.6 Success state

Replace the form with a panel: "Received, {first name}. {coordinator} will email you at {email} to confirm your call." Show the case ID, the documents received (with ticks), and the ones still to send, with the line "Reply to our email with anything else, any time." No status language and no timeline promises.

### 6.7 Feature flag

`INTAKE_ENABLED` defaults to `false` in production and `true` in previews. While it is false, the hero and the rest of the site behave exactly as they do today, with only the Phase 1 fixes.

### 6.8 Copy rules

Plain English, warm, confident, short. No jargon. Do not present PetViza as a veterinary practice or claim accreditation. Reuse the site's existing voice ("Go farther. Worry less.", "Begin your journey"). Do not add new factual claims beyond this file.

## 7. Phase 3: BUILD THE WEBHOOK. EMAIL hello@mypetviza.com AND WRITE EVERY SUBMISSION TO THE GOOGLE SHEET.

This is the delivery pipeline the site was always meant to have. It serves three sources: the new intake, the existing consultation modal and contact form, and the chatbot lead form. Every one of them must produce an email to hello@mypetviza.com and a Sheet row.

### 7.1 Flow

1. The browser converts photos to PDFs and asks `POST /api/upload-url` for upload targets. The server issues single-use signed targets limited to `application/pdf`, at most 10 MB, under `cases/{caseId}/`. The server issues the case ID on the first call, or on `/api/lead` when there are no files. The browser keeps it for retries.
2. The browser uploads each file directly to private storage, with progress.
3. The browser POSTs JSON to `/api/lead` (contract in 7.2).
4. `api/lead.js` validates, rate limits, checks the honeypot, builds 15-minute signed download URLs for each file, and calls the Apps Script web app (7.4) with the shared secret. It waits for `{ok:true}`.
5. On success it deletes the staged files (best effort) and returns `{ok:true, caseId}`. On failure it retries once after one second, then returns a 502 with a friendly error and leaves the files so the visitor can retry.
6. A daily cron purges staged files older than 48 hours.

Storage: Vercel Blob with private access is the first choice if the account supports it, because it keeps everything on Vercel. Supabase Storage with a private bucket is the alternative. Never use a public, listable bucket. **STOP AND ASK CAM** before creating any new vendor account or paid resource.

### 7.2 Submission contract

Backward compatible. The legacy required fields stay required. `intake` is optional. Unknown fields are dropped. Add a whitelist and length limit for every new field.

```json
{
  "kind": "intake",
  "caseId": "PV-7K3M9QXD",
  "source": "intake",
  "lang": "en",
  "firstName": "Ana",
  "lastName": "Ruiz",
  "email": "ana@example.com",
  "phone": "+1 786 555 0199",
  "destination": "Colombia",
  "departureDate": "2026-12-15",
  "consultationDateTime": "2026-10-05T10:30",
  "consultationDateTimeUtc": "2026-10-05T14:30:00.000Z",
  "timezone": "America/New_York",
  "petDetails": "Luna, dog, Labrador mix, 3 years. Microchip: yes. Rabies: current, given 2026-03-01.",
  "message": "",
  "consent": "yes",
  "consentVersion": "2026-09",
  "consentAt": "2026-09-30T14:02:11.000Z",
  "intake": {
    "pet": { "name": "Luna", "species": "dog", "breed": "Labrador mix", "ageOrBirthDate": "3 years" },
    "microchip": { "status": "yes", "number": "985112345678901", "implantDate": "2025-11-02" },
    "rabies": { "status": "yes", "dateGiven": "2026-03-01", "expires": "2027-03-01" },
    "documents": [
      { "slot": "rabies_certificate", "status": "uploaded", "files": [{ "path": "cases/PV-7K3M9QXD/rabies_certificate-1.pdf", "bytes": 412331 }] },
      { "slot": "microchip_record", "status": "not_yet" },
      { "slot": "vaccine_history", "status": "uploaded", "files": [{ "path": "cases/PV-7K3M9QXD/vaccine_history-1.pdf", "bytes": 98210 }] },
      { "slot": "other", "status": "none" }
    ]
  }
}
```

`kind` is `intake`, `inquiry` (modal or contact form), or `chat` (chatbot lead form, with `transcript`). Compose `petDetails` from the structured fields so the legacy consumers still get a readable summary. Every `source` value is tagged so the Sheet shows where a lead came from.

### 7.3 The Apps Script web app

Create `apps-script/Code.gs` and a plain-language `apps-script/DEPLOY.md` for a non-developer. The script is container-bound to the Sheet "PetViza Leads".

Script Properties: `WEBHOOK_SECRET`, `COORDINATOR_EMAIL` (hello@mypetviza.com), `DRIVE_PARENT_FOLDER_ID`, `SEND_VISITOR_CONFIRMATION` (true), `CALENDAR_ENABLED` (false).

`doPost(e)`:

1. Parse the JSON. If the secret does not match, return `{ok:false, error:"unauthorized"}`. Apps Script cannot set status codes, so `api/lead.js` must treat `ok:false` as a failure.
2. Take `LockService.getScriptLock()` (wait up to 20 s).
3. Idempotency: if the case ID already exists in the Sheet, return the earlier result with `duplicate:true` and send no second email.
4. Create the Drive folder `{caseId} - {petName} - {destination}` under the parent. For each signed URL, `UrlFetchApp.fetch` it and save the blob into the folder. If a file fails, continue, list it as missing, and add the flag `file_transfer_failed`. Still deliver the lead.
5. Append one Sheet row (Appendix B). Format phone and microchip number columns as plain text so leading zeros and `+` survive.
6. Email the coordinator (Appendix D) with `replyTo` set to the visitor's email.
7. If `SEND_VISITOR_CONFIRMATION` is true, email the visitor a short confirmation from the same account.
8. If `CALENDAR_ENABLED` is true, create a tentative 30-minute hold on the coordinator's calendar, titled "HOLD: consultation request, {first} {last}", with a link to the Sheet row. Do not invite the visitor. Default off, because the time is a request, not a booking.
9. Return `{ok:true, caseId, folderUrl, rowNumber}`.

Wrap everything in try/catch. On any failure after step 1, still email the coordinator the plain text of the submission so nothing is lost, and return `ok:false` so `api/lead.js` retries. Processing is idempotent, so a retry never duplicates a row.

Deployment settings: Execute as **Me**, and "Me" must be the hello@mypetviza.com Google Workspace account so mail comes from that address. Who has access: Anyone (the shared secret protects it). Copy the `/exec` URL into the Vercel variable `LEAD_WEBHOOK_URL`. Reuse the variable name `lead.js` already reads if it has one.

Gotchas: Apps Script answers a POST with a redirect, so the Node `fetch` must use `redirect: 'follow'`. Mail quotas are about 100 recipients a day on a free Google account and about 1,500 on Workspace. Execution time is capped, so keep file copying under a few minutes.

### 7.4 The Sheet

One tab named `Leads`. Header row in Appendix B. Freeze the header row. Set the spreadsheet time zone to America/New_York. Add conditional formatting that highlights any row where `Flags` is not empty.

### 7.5 Reliability and security

- Retry once from `api/lead.js`. Idempotent by case ID.
- Timeout to Apps Script about 25 s. Set the function `maxDuration` high enough. Show progress while the visitor waits.
- Rate limit `/api/lead`, `/api/upload-url`, and `/api/chat` per IP. Keep the honeypot. Recommend Cloudflare Turnstile for the intake form. **STOP AND ASK CAM** before adding it.
- Set a Vercel alert on the error rate for `/api/lead`.
- Environment variables (names only): `LEAD_WEBHOOK_URL`, `LEAD_WEBHOOK_SECRET`, the storage token your storage choice needs, and later `ANTHROPIC_API_KEY` and `CHAT_MODEL`. Never commit values.

### 7.6 Cam's prerequisites

1. Create a Google Sheet named "PetViza Leads" owned by, or shared with edit access to, the hello@ account. Paste the header row from Appendix B into cell A1.
2. Create a Drive folder "PetViza Cases" in the same account. Give the agent the folder ID.
3. Deploy the Apps Script under the hello@ account following `DEPLOY.md`.
4. Add the environment variables in Vercel.
5. Confirm the hello@ mailbox receives mail and that messages do not land in spam.

### 7.7 Go-live checklist

Flip `INTAKE_ENABLED` to `true` in production only after all of these pass on a preview:

- A full intake with three documents, from a real iPhone and a real Android phone, produces one email, one Sheet row, and a Drive folder with three openable PDFs.
- The consultation modal, the contact form, and the chatbot lead form each produce an email and a row.
- Submitting the same case ID twice produces one row.
- A failed webhook (wrong secret) shows the friendly error, keeps the visitor's data, and emails the coordinator the plain-text submission.
- The coordinator has read the email and approved the format.

## 8. Phase 4: chatbot upgrade

### 8.1 Starting point

Today's bot is a keyword matcher with six canned replies, no LLM, and no retrieval. This phase replaces the brain, not the look. Keep the panel, launcher, quick replies, and lead form. Keep the lead hand-off to the same `/api/lead` pipeline. Keep the transcript in the lead.

### 8.2 It should feel like a conversation

- A typing indicator like an iPhone message: a left-aligned grey bubble with three dots pulsing in sequence. Use `--muted` for the bubble and `--muted-foreground` for the dots.
- Show the bubble after a short "reading" pause of about 350 ms, and keep it visible for at least about one second even when the answer is ready sooner. A longer answer gets a slightly longer pause, capped at about three and a half seconds.
- Then reveal the answer progressively at a natural pace, streaming from the model if possible, never as one instant block. Tapping the message shows the rest at once.
- Respect `prefers-reduced-motion`: replace the animated dots with static "PetViza is typing" text.
- Announce to screen readers only when a message is complete, not per token.
- Follow-ups work. Keep the last ten turns as context. If the destination is unknown, ask one short clarifying question before answering requirements.
- If the visitor writes in Spanish, answer in Spanish. Keep the citations as they are.
- When the visitor wants to talk to a person, offer the lead form, as today.

### 8.3 Answer style

Answers read like a good AI assistant reply: a direct first sentence, then short scannable paragraphs or a brief list, and a clear next step. Typically under 180 words. Every factual claim that comes from a source carries an APA 7 in-text citation, and the answer ends with a compact "References" list in APA format. Examples are in Appendix E.

Rules for citations:
- Cite only sources that were actually retrieved for that answer. Never invent, guess, or reconstruct a citation.
- Use the stored author, year (or "n.d."), title, URL, and retrieval date from the knowledge base record.
- If retrieval finds nothing relevant, say so plainly and route to a consultation. Do not answer from memory.

### 8.4 Retrieval (RAG)

Audit first, then build. Confirm today's bot has no retrieval, then implement it:

- **Knowledge base.** A curated set of sources, each stored with `author`, `year`, `title`, `url`, `retrievedAt`, `type`, and the text split into chunks. Seed list, to be verified and expanded by you:
  - USDA APHIS pet travel pages: process overview, exporting a pet to another country, country-specific requirements, accredited veterinarians, and endorsement.
  - CDC dog importation pages and FAQs.
  - Pet policy pages of airlines that matter for Miami: American, Delta, United, Avianca, LATAM, Copa, Iberia.
  - Official pet import pages for the top destinations: Colombia, Mexico, Dominican Republic, Spain and the EU, United Kingdom, Canada, Brazil, Argentina, Peru, Ecuador, Chile, Costa Rica, Panama.
  - PetViza's own FAQ and process copy from the site, cited as PetViza.
- **Retrieval.** Embed the chunks, retrieve the top few by similarity with a keyword fallback, and pass them to the model with their citation records.
- **Store.** Supabase with pgvector is a good fit, and Cam already has an account and will need it for the future portal. A small, curated knowledge base can also be served directly in the prompt with caching, which is simpler and often more accurate. Choose one and explain why. **STOP AND ASK CAM** before adding a new vendor.
- **Grounding prompt.** Answer only from the retrieved sources. Cite as in 8.3. Never give veterinary medical advice. Always note that requirements change and that PetViza confirms them personally. Keep PetViza's concierge framing.
- **Freshness.** Store `retrievedAt` with every source. Add a monthly job that re-fetches the sources and flags changed pages for human review. Do not auto-publish changed content.
- **Model.** A current Claude model, set by the `CHAT_MODEL` environment variable. Check Anthropic's current documentation for model names and streaming. The API key lives only in a server route, `POST /api/chat`. Never put it in client code.

### 8.5 Safety and disclosure

- Under the input, show: "Answers are AI-generated from official sources. PetViza confirms your route personally." Mention the AI provider in the privacy notice.
- Rate limit per IP, cap input at 500 characters, cap output length, and set a monthly spend alert.
- Store a chat transcript only when a visitor submits the lead form, as today. Do not keep anonymous chats beyond short-lived, personal-data-free logs.
- Fix the lead form's success text so it is true once Phase 3 is live.

### 8.6 Acceptance

Build a test set of at least twenty realistic questions, including: where to start, which documents, timing for a named country, finding a vet, airline cabin versus cargo, a question with no good source, a medical question, a Spanish question, and a prompt-injection attempt. Pass means: grounded answers, correct APA citations drawn only from retrieved sources, a refusal to invent, the typing behavior above, and first visible text within about three seconds for typical questions. Include the test set in the repo.

## 9. Not now, but design so it fits later

- **Client portal.** Later, clients get a private page listing the documents they have sent and the ones still needed, with an upload button. No status, no timeline, no messages. Sign-in by emailed link, not passwords. The case ID, the slot names, and the Drive folder structure in this file are its foundation. Do not build it now.
- Also later: HubSpot or another CRM, text messages, Spanish, payments, a per-country rules engine, and any kind of case status tracking.

## 10. Test plan

- Real devices: iPhone Safari and Android Chrome for the intake, camera capture, and uploads. Desktop Chrome, Safari, and Firefox for layout and drag and drop.
- Upload cases: a 6 MB phone photo, a HEIC photo, three photos merged into one PDF, a 25 MB file (friendly rejection), a wrong file type (friendly rejection), and going offline mid-upload (retry works).
- Submit cases: double-click submit, a failed webhook, an old-style payload from the modal, a honeypot hit, and a rate-limit hit.
- Email: arrives in inboxes at Gmail, Outlook, and iCloud. Reply-To is the visitor. Links to the Drive folder open for the coordinator.
- Accessibility: keyboard only, a screen reader pass on the intake, AA contrast, reduced motion.
- Regression: the modal, the contact form, `smoothScroll`, the FAQ accordion, the chatbot panel, and page speed on a mid-range phone.

## 11. Report back after each phase

1. What changed, as a short list of files.
2. What you verified and how, including the real-device results.
3. What surprised you or contradicted this file.
4. Anything you need from Cam.
5. The preview URL, and the production deploy status.

---

## Appendix A: intake copy

The five questions and why we ask (left column of the intake section):

1. **Where is your pet going?** The destination decides every rule, test, and form.
2. **When are you leaving?** The departure date sets the timeline. Some steps take weeks.
3. **Tell us about your pet.** Species, breed, and age change what is required.
4. **Is there a microchip?** The number and date matter. Many countries want the chip placed before the rabies shot.
5. **Is the rabies vaccine current?** The date given and the expiry are the most common cause of delay.

Document slots:

```json
[
  { "slot": "rabies_certificate", "label": "Rabies vaccination certificate", "help": "Signed by the vet who gave the shot. Shows the date, the expiration, and the vaccine lot number." },
  { "slot": "microchip_record", "label": "Microchip record", "help": "The 15-digit chip number and the date it was implanted." },
  { "slot": "vaccine_history", "label": "Full vaccination history", "help": "A printout from your regular vet listing every vaccine and date." },
  { "slot": "other", "label": "Anything else", "help": "Import permits, lab results, earlier health certificates, airline confirmations. Optional." }
]
```

## Appendix B: Google Sheet header row

Paste this into cell A1 of the `Leads` tab (tab-separated, it fills one column per heading):

```
Received (ET)	Case ID	Source	First name	Last name	Email	Phone	Destination	Departure date	Days until departure	Consultation requested (local)	Consultation requested (UTC)	Timezone	Pet name	Species	Breed	Age or birth date	Microchip	Microchip number	Microchip implant date	Rabies current	Rabies date given	Rabies expires	Documents received	Documents missing	Drive folder	Message	Flags	Language	Consent version	Consent time (UTC)	Chat transcript
```

Notes: `Flags` holds short codes such as `departure_under_6_weeks`, `departure_under_10_days`, `rabies_not_current`, `rabies_unsure`, `no_microchip`, `microchip_unsure`, `missing_documents`, `file_transfer_failed`. `Documents received` and `Documents missing` list slot labels. `Chat transcript` holds the first 1,500 characters for `chat` leads. Times in the first column are America/New_York.

## Appendix C: privacy notice (draft, to be reviewed by the client before relying on it)

Publish at `/privacy`. Keep the language plain. Bracketed items need the client's input.

> **PetViza Privacy Notice** (draft, last updated [DATE])
>
> **Who we are.** PetViza, [LEGAL ENTITY NAME AND ADDRESS], coordinates international travel paperwork for pets. Contact: hello@mypetviza.com.
>
> **What we collect.** The details you type into our forms: your name, email, phone number, travel plans, and your pet's details. The documents you upload, such as vaccination and microchip records. If you use our chat assistant and ask for a consultation, the conversation is included with your request.
>
> **Why.** To reply to you, plan your pet's route, schedule your consultation, and prepare the paperwork.
>
> **Who sees it.** The PetViza team. We use service providers to run the site and handle your information: Vercel (website hosting), Google (email, spreadsheets, and file storage), [STORAGE PROVIDER], and [AI PROVIDER] for the chat assistant. We share information with veterinarians, airlines, or government offices only as needed for your trip and with your direction. We do not sell your information.
>
> **Uploaded files.** Files are sent over an encrypted connection, stored privately, and copied into a private folder for your case. Temporary copies are deleted shortly after.
>
> **How long we keep it.** [RETENTION PERIOD, e.g. for as long as needed to complete your case, then for X months].
>
> **Your choices.** Email hello@mypetviza.com to see, correct, or delete your information. You can stop using the chat assistant at any time.
>
> **Changes.** We will update this page and its date when this notice changes.

The consent line next to the submit button, version `2026-09`:

> I agree that PetViza may use these details and the documents I upload to respond to me, plan my pet's route, and schedule my consultation. I have read the Privacy Notice.

## Appendix D: email templates

**To the coordinator (hello@mypetviza.com).** Reply-To is the visitor.

Subject lines:
- `New PetViza intake: {petName} to {destination} on {departureDate}`
- `New PetViza inquiry: {firstName} {lastName}, {destination}`
- `New chat inquiry: {firstName} {lastName}`

Body, top to bottom:
1. Case ID and received time in Eastern time.
2. Flags in bold, one per line, in plain words: "Departure in 23 days", "Rabies: not sure", "No microchip", "Missing: microchip record".
3. A small table: owner, email, phone, route, departure date, pet (species, breed, age), microchip, rabies, consultation requested (local time, plus UTC in small type), message.
4. Documents received, with the Drive folder link.
5. Footer: "Reply to this email to reach {firstName} directly."

**To the visitor.** From hello@mypetviza.com, Reply-To hello@mypetviza.com.

Subject: `We received {petName}'s details`

> Hi {firstName},
>
> Thank you. {coordinator} will email you personally to confirm your consultation. Your reference is {caseId}.
>
> You asked for a call around {consultationDateTime local}. We will confirm a time that works.
>
> What we received: {list}. Still to send, whenever you have them: {list}. Just reply to this email with photos or PDFs.
>
> Warmly,
> PetViza
> hello@mypetviza.com · Privacy Notice

No timeline promises and no status language.

## Appendix E: APA examples for the chatbot

Sample answer shape. The content is illustrative only; real answers come from retrieved sources.

> Most international trips start with a health certificate from a USDA-accredited veterinarian, and the exact packet depends on your destination (U.S. Department of Agriculture, Animal and Plant Health Inspection Service [APHIS], n.d.). Because rules change, PetViza confirms the current list for your route.
>
> A good first step is to tell me where you are headed and when. I can also set up a consultation.
>
> **References**
>
> U.S. Department of Agriculture, Animal and Plant Health Inspection Service. (n.d.). *Take a pet from the United States to another country (export)*. Retrieved September 30, 2026, from https://www.aphis.usda.gov/pet-travel/us-to-another-country-export

Conventions to follow: group-author in-text citation spelled out with its abbreviation in brackets on first use, then the abbreviation after; `n.d.` when the page has no date; a retrieval date for pages that change over time; titles in sentence case; italic titles; one reference entry per source cited in that answer. A second example source to seed and verify: Centers for Disease Control and Prevention, *Entry requirements for U.S.-vaccinated dogs from high-risk countries*, https://www.cdc.gov/importation/dogs/us-vaccinated-high-risk-countries.html. Verify every title and URL against the live page before adding it to the knowledge base.
