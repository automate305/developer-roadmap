# Codex handoff: English/Spanish toggle and coral tweak for mypetviza.com

You are working on the **live PetViza website** (PetViza = pet travel certificate concierge, spelled with a Z). Read this whole file, then do the work in Section 4. Do not touch anything listed in Section 5.

## 1. Where the site lives

| Thing | Value |
|---|---|
| GitHub repo | `automate305/petviza-demo`, branch `main` |
| Vercel project | `petviza-demo` (team "Camilo's projects", slug `cam-automate305`) |
| Production domains | mypetviza.com, www.mypetviza.com |
| Deploy method | Push to `main`. Vercel builds it automatically. There is no build step; it is plain HTML, CSS, vanilla JS, and one serverless function. |
| Files | `index.html`, `privacy.html`, `chatbot.js`, `chatbot.css`, `api/lead.js`, `package.json` |

Do NOT use the `petviza` Vercel project (stale) or the `a305-sep-web` project (unrelated). Do NOT use the `claude/vercel-deployment-uneqff` branch in `automate305/developer-roadmap`; it holds an outdated static copy of the page.

## 2. What is already done (commit `224a1fd` on `main`, already live)

1. `index.html` desktop nav now has this button immediately before the "Begin your journey" button:

```html
<button id="lang-toggle" style="background:none;border:1px solid #1a2744;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:0.85rem;font-weight:600;letter-spacing:0.05em;color:#1a2744;">ES</button>
```

2. `index.html` loads the toggle script just before `</body>`, after `chatbot.js`:

```html
<script src="petviza-lang-toggle.js"></script>
```

3. The mobile menu now has a second toggle (`<button class="lang-toggle">ES</button>`, no id, above the mobile "Begin your journey" button). The desktop button also carries `class="lang-toggle"` now. Bind the script to `.lang-toggle`, not the id.

4. The coral accent variable `--accent` in the `:root` block changed from `2 76% 76%` to `2 70% 66%` (a bit darker). It is a single HSL token (used as `hsl(var(--accent))`), so every coral element follows it.

## 3. What is NOT done

- **`petviza-lang-toggle.js` does not exist.** The script tag 404s and the `ES` button does nothing. This is the main job.
- Spanish copy for the site has never been written.

## 4. Your tasks

### 4.1 Create `petviza-lang-toggle.js` (repo root, next to `index.html`)

Behavior:
- Default language is English. Remember the choice in `localStorage` key `pv_lang` (wrap reads and writes in try/catch; the page must work without storage).
- Clicking `#lang-toggle` switches the whole page between EN and ES. The button shows the language you would switch TO: `ES` while the page is English, `EN` while it is Spanish. Update `aria-label` and the `<html lang>` attribute on every switch.
- Auto-detect on first visit: if there is no saved choice and `navigator.language` starts with `es`, start in Spanish.
- Implementation: add `data-i18n="key"` attributes to translatable elements in `index.html` (and `data-i18n-placeholder` for input placeholders), and keep an `EN` and `ES` dictionary inside the JS file. Do not do a find-and-replace on the DOM text at runtime. Keep the English strings identical to what the page says today, so nothing changes for English visitors.
- Translate: nav, hero, process section, expertise section, FAQ, footer, the consultation modal and its form labels, buttons, consent line, and any alt text or aria labels. Use natural, warm, professional Latin American Spanish (this is a concierge service for Miami, Florida clients, so use "usted" register). Keep brand terms as they are: PetViza, USDA, APHIS, CDC, microchip, and so on.
- Keep proper nouns, the hello@mypetviza.com address, and phone/number formats unchanged.
- The page must not flash or reflow on load. If the saved language is ES, apply it as early as possible.
- No dependencies, no build step, no new libraries. ES5-compatible enough to run in current Safari and Chrome.

### 4.2 Mobile toggle

Already in the HTML (see Section 2, item 3). Make sure the script binds every `.lang-toggle`, keeps both labels in sync, and that the mobile menu closes or stays sensibly after a switch. Both buttons say `ES` while the page is English and `EN` while it is Spanish. Clicking translates the entire site.

### 4.3 Coral check

Open the page at desktop and phone widths and confirm the darker coral still reads well. Check text contrast where coral is used as text on a light background (hero emphasis word) and as an icon or dot on navy. If any coral text falls below WCAG AA (4.5:1 for normal text), nudge the lightness down a few points more. Report the final value.

### 4.4 Language and the lead flow

- The consultation modal and contact form post to `api/lead.js`. When the page is in Spanish, include the field `lang` with value `es` (otherwise `en`) in the payload, so the coordinator knows which language to reply in. Do not change anything else about how `api/lead.js` works, and do not change which fields it requires.
- If `api/lead.js` rejects unknown fields, add `lang` there in the smallest way possible and tell Cam.

## 5. Do not touch

- `api/lead.js` behavior, other than accepting the optional `lang` field described above.
- `chatbot.js` and `chatbot.css` (the chatbot stays as is; do not translate it in this pass).
- The hello@mypetviza.com contact fix, `privacy.html`, and the consent checkboxes added in Phase 1.
- Any environment variable, secret, or Vercel project setting.
- No new tracking scripts, fonts, or third-party requests.

## 6. Before you push

1. Open `index.html` locally, click the toggle both ways on desktop and phone width, and confirm no untranslated English remains in ES mode (scan every section, the FAQ, the footer, and the open modal).
2. Confirm English mode is visually identical to before.
3. Confirm there are no console errors and no 404s.
4. Reload with the language saved as ES and confirm it persists.
5. Show Cam the Spanish copy for review before it goes to production, since this is a client-facing site and the client may want to approve wording. If Cam says to ship, push to `main`.

## 7. After you push

- Confirm the new Vercel deployment on `petviza-demo` reaches READY and is aliased to mypetviza.com.
- Load https://mypetviza.com and test the toggle on the live site.
- Rollback if anything breaks: redeploy the previous production deployment `dpl_r7Yc4Y5oudjWfvHC1NFaz6uKa9qM` (the Phase 1 version) in the Vercel dashboard, or `git revert` your commit.

## 8. Report back

Send Cam a short note: files changed, final coral HSL value, anything you could not translate or were unsure about, whether `api/lead.js` needed a change, and the live URL you tested.
