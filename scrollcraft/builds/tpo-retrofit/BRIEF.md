# TPO Wellness: scroll-craft retrofit

Status: batch-journey signature explicitly approved by the user on 2026-11-01. Existing site and supplied SCROLLCRAFT-RETROFIT-BRIEF.md are the source of truth. This is a retrofit, not a rebuild.

## Creative authority and eight brief topics

1. Vibe: supplied brief says “certified, calm, dimensional”. Retain the site's forest/paper palette, DM Sans, Newsreader, and JetBrains Mono. No new brand styling.
2. Journey: preserve hero, about, services, CTA, products, herbal-clinic, quote-booking, and contact in their current order, plus existing topbar/header/footer.
3. Energy: calm arrival, quiet credibility, one process peak, brief momentum, catalog abundance, warm downshift, still conversion, open-door close.
4. Remembered moment: services is the single peak. The user selected “Batch journey” when offered it versus the gummy mold wipe.
5. Signature: a scroll-driven batch trace accumulates ingredient, formulation, molding, quality-check, and packaging checkpoints. Photographs are explicitly ingredient/format references, not evidence of machinery, finished formulas, or certification.
6. Aesthetic range: existing editorial botanical brand. Do not replace Bootstrap layout or turn the entire site into a cinematic template.
7. World: distinct section scenes, not one continuous world. Keep existing anchor navigation and useful forms.
8. Assets: use only existing non-cannabis gummy, apple, chamomile, reishi, flavor-library images and packaging illustration. No KIE generation, new photography, new numbers, or new certification/team claims.

## Evidence and corrections to the supplied brief

- The catalog actually contains 12 reference formulas, not 13. Preserve all 12 and their filter/spec/quote wiring.
- The seven service cards are supplement capabilities, not pre-roll/flower categories. Keep their current copy, categories, and quote buttons.
- herbal-process-capabilities.jpg and oem-herbal-hero.jpg depict legacy cannabis products. Exclude both. Use existing chamomile and reishi ingredient references in the herbal/clinic scene, without presenting these as premises or staff photos.
- Thai FDA and GMP are already claimed on the page. No independently verified USA-trained-team claim exists in the current content; do not add it. Third credibility item uses existing CoA/lab-documentation text instead.
- No verified production/area/SKU statistics are available. No animated counters.
- No video is needed; Blob/range-video deployment checks are not applicable. Verify CSS, JS, images and actual deployment instead.
- playwright-core installed locally with --no-save --package-lock=false; doctor and a real Chromium render passed. KIE key is optional and unused.

## Grammar: factory field guide

An explicitly constrained retrofit grammar, not a relabeled filmic template:

- Navigation: preserve Bootstrap anchor navigation, employee/login controls and existing destinations. Readers can jump directly to catalog, form, clinic, and contact.
- Sequence: preserve all existing sections. Natural-flow factual sections surround one contained process exhibit; capability cards remain normal flow below the exhibit.
- Hero: stable semantic type and independently moving cloud, photo, foreground, and atmosphere layers, not a full-bleed scrub or cinematic takeover.
- Ending: stationary quote/meeting inputs followed by usable contact details and map. No pinned close or magnetic CTA.
- Bans: no worldflight, video scrub, scroll hijacking, transformed body copy, pinned forms, animated statistics, invented approvals, new imagery, hidden keyboard targets, internal-page changes, or direct push to main.

Why the eight stock grammars do not fit unchanged: filmic one-shot forbids jump navigation; chaptered editorial removes existing fixed navigation; live surface replaces the marketing page with a tool; continuous world removes section boundaries; typographic poster forbids the existing photos/cards; gallery/catalog eliminates the existing manufacturing argument; split stage demands an all-page comparison; rhythmic cutlist forbids the approved process pin. Their structural changes violate the retrofit requirement.

## Feeling curve (before the score)

| Act | Intended feeling | What causes it |
|---|---|---|
| Hero | Trust on arrival | Readable existing offer, gummy reference photograph, four restrained depth planes |
| About | Grounded | Thai FDA, GMP, and existing lab-documentation trust signals arrive individually |
| Services | Capable: PEAK | The visitor advances one batch from ingredients to its packaging, leaving a completed trace |
| CTA | Momentum | A subtle lateral texture moves behind stable sample-review copy |
| Products | Abundance | Three independent formulation waves appear after opening the existing catalog |
| Herbal / clinic | Intimate | Chamomile and reishi references move at different rates beside stable division copy |
| Quote / meeting | Clarity | All motion stops at the form; fields and controls remain stationary |
| Contact | Open door | A restrained map reveal resolves into static address, contact form and useful destinations |

Peak sentence: “I moved a gummy batch from ingredients to packaging, and could see the checks it passed along the way.” This is a process explanation, not a claim about an actual tracked batch.

Tell-someone sentence: “It's the site where your scrolling takes a gummy batch through the factory process and leaves its whole path behind.”

Authored silence: the about act is deliberately quiet; conversion controls are deliberately still. No blank pinned screens or filler scroll are intended.

## Score and layer contract

| Section | Primary device family | Composition / span |
|---|---|---|
| hero | parallax + load-time kinetic lines | Natural flow, data-sc-span 2.6 metadata; no added pin distance |
| about | flow + in stagger | 60ms credibility stagger; existing production timeline preserved |
| services | pin + bespoke wipe/trace | One inner batchJourney exhibit, desktop span about 3.6; all 7 cards remain below |
| cta | lateral drift | Stable copy; clipped decorative pattern drifts with act progress |
| products | reveal waves | Three independent groups; mobile simple entry reveals; existing disclosure/filtering preserved |
| herbal-clinic | parallax | Stable text, separate chamomile and reishi image planes |
| quote-booking | flow, still | No moving ancestor, pinning, cue, or stagger on any form control |
| contact | reveal | Map frame only; contact copy/form remain visible and still, no counters |

Hero planes: far #heroClouds/Vanta (smallest travel), gummy photo subject (moderate), foreground edge scrim (stronger), restrained atmosphere (independent). Text and CTAs remain in a stable plane; no duplicated gummy cutout, invented transparent art, full-frame opaque scrim, or pointer capture.

Mobile ≤860px: type-first hero, bounded image crops, process stages in normal document flow, product waves with once-only entry reveals. No long pinned scene. Compact 360×640 and typical 390×844 must both work. Reduced motion: assembled type, static complete planes, all five process stages reachable, no Vanta, no hidden reveals, still forms. No-JS: content visible; no scripted form submits personal information through default GET.

## Fingerprint gate

Registry scrollcraft/FINGERPRINTS.md was empty at planning time. No prior rows to compare against. Record the final measured act shape and signature after verification; do not invent a numerical difference score.

## Verification and delivery plan

Use unmodified skill engine copies; compare hashes. Run shoot.mjs desktop, 390px mobile, and reduced-motion strips. Inspect all strips and problem frames. Exercise catalog disclosure/filtering/spec modal, category-to-quote selection, meeting tabs, mobile navigation, focus and typing mid-scroll, reduced motion, no-JS form behavior, image loading and overflow. Preserve initial failed evidence if repairs are needed. Real phone/iOS behavior remains outside headless proof.

Develop on scroll-retrofit, commit/push that branch, open PR back to main. Do not deploy to production or merge without approval. Verify a branch preview if one is available; otherwise report the missing preview deployment as a concrete acceptance blocker rather than claiming production verification.

## Verification notes

- Initial desktop proof encountered a screenshot timeout with the software-rendered SwiftShader cloud shader. The static sky is now used when WebGL reports a major performance caveat or a known software renderer; hardware-backed desktop WebGL retains Vanta. The later desktop strip completed without dead-scroll findings. Headless software rendering does not prove Vanta performance on physical GPUs.
- Mobile 390×844 and compact 360×640: five process stages remain visible in normal flow; no horizontal overflow. Reduced-motion desktop: all stages remain visible and static, with Vanta disabled. Dynamic viewport and motion-preference changes were exercised both ways.
- The collapsed catalog retains 12 formulations. Mouse and keyboard filtering, all seven capability quote buttons, meeting-tab switching and the formulation-spec modal were exercised. The legacy packaging button still falls back to Custom Gummy Formulation because the form has no matching packaging pill.
- Quote fields were typed while scrolled and focus retained; no ancestor carried a transform. An isolated intercepted JSONP quote submission confirmed serialization and success handling without sending a real email. With JavaScript disabled all four forms remain disabled with a contact fallback, avoiding accidental personal-data submission to the URL.
- Contact sheets sample scroll positions rather than the expanded catalog; the full expanded catalog was also captured separately. The capture engine does not grade text contrast unless it is a cue; static text needs visual inspection. A real phone, iOS touch behavior, hardware-backed GPU, and a production deployment remain outside local headless proof.

### Cold feel check

Observed: hero = assured, about = informational, services = exploratory, CTA = momentum, products = restrained, herbal/clinic = botanical, form = functional, contact = open. Compared with the intended curve, services needed clearer process text and the product range initially felt too much like one grid; the final version keeps all stage text legible and breaks the expanded catalog into three labeled waves. No claim is made that a subjective feel check proves customer preference.
