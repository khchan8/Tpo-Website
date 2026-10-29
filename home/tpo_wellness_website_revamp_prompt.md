# Master Prompt: Complete Website Revamp for TPO Wellness Ltd. (Bangkok OEM Supplement Gummy Manufacturer, Herbal Shop & Thai Traditional Clinic)

Copy and paste the prompt below into your AI coding assistant or web builder to generate the complete, production-ready website for **GitHub Pages**.

## Copy-Paste Prompt

**Role & Objective**
Act as a Senior Creative Frontend Developer and UI/UX Architect. Build a complete, modern, high-converting, single-page production HTML5 website (`index.html`) for **TPO Wellness Ltd.**, a premier **White-Label & OEM Supplement Gummy Manufacturer**, **TPO Herbal Shop**, and **Thai Traditional Clinic** based in **Bangkok, Thailand**.

The company previously operated as a cannabis OEM manufacturer and has **completely pivoted away from cannabis**. You must **remove 100% of cannabis, pre-roll, flower, and legacy cannabis brand references** (such as Fuzzies, Auntie Aloha, Mana Cannabis, and Tyson 2.0) while preserving the company's legitimate contact details, Bangkok map embed, local asset paths, Google Apps Script form backend, and `localStorage` Employee Portal authentication logic from the legacy site.

The website will be hosted on **GitHub Pages** and must run as a self-contained static frontend using CDN-hosted libraries (Bootstrap 5, AOS, Bootstrap Icons, Boxicons, GLightbox, Swiper, Three.js r134, and Vanta.js).

## 1. Brand Positioning & Business Pillars

Position **TPO Wellness Ltd.** around three integrated wellness pillars:

| Business Pillar | Core Offerings & Value Proposition | Target Audience |
| :--- | :--- | :--- |
| **1. OEM & White-Label Supplement Gummy Manufacturing (Core B2B)** | Turnkey formulation, flavor/texture R&D, lab testing, bulk manufacturing, and custom packaging in **Thai FDA Approved & GMP Certified Facilities** in Bangkok. Specializing in **Creatine Gummies**, **Protein Gummies**, **Sleep Gummies**, **Relax / Stress-Relief Gummies**, and **Custom Formulations** (Hydration/Electrolytes, Focus/Nootropics, Immune Support, Vitality, Capsules, Powders, and Functional Elixirs). | Global & ASEAN supplement brands, fitness/gym chains, wellness startups, and retail distributors. |
| **2. TPO Herbal Shop (Retail & Botanical Extracts)** | Curated Thai botanical remedies, standardized herbal extracts, functional mushroom blends (Lion's Mane, Reishi, Chaga), and retail wellness supplements crafted with pharmaceutical-grade quality control. | Retail wellness consumers, health-conscious travelers, and wholesale herbal buyers. |
| **3. Thai Traditional Clinic (Holistic Clinical Care)** | Licensed Thai Traditional Medicine (TTM) clinic in Bangkok providing personalized herbal consultations, restorative therapies, stress/sleep recovery programs, and integrative holistic healthcare. | Local Bangkok residents, expats, and medical/wellness tourism clients. |

## 2. Interactive 3D Backgrounds with Vanta.js (from GitHub `tengbao/vanta`)

Replace the legacy 2D `.energy-stream-canvas` scripts with interactive WebGL 3D backgrounds powered by **Three.js (`r134`)** and **Vanta.js (`0.5.24`)** via CDN:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.globe.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.cells.min.js"></script>
```

### Hero Section (`#hero`) — `VANTA.GLOBE`
Use **`VANTA.GLOBE`** in the full-viewport `#hero` container to symbolize TPO Wellness as Bangkok's global OEM manufacturing and export hub connecting Thailand's wellness innovation with international markets:
* **Configuration**:
  * `el: "#hero"`
  * `mouseControls: true`, `touchControls: true`, `gyroControls: false`
  * `minHeight: 500.00`, `minWidth: 200.00`, `scale: 1.00`, `scaleMobile: 0.75`
  * `backgroundColor: 0x071a1e` (Deep Biopharma Teal-Navy)
  * `color: 0x10b981` (Vibrant Bio-Emerald for primary 3D globe lines and nodes)
  * `color2: 0x38bdf8` (Luminous Cyan-Gold accent for secondary orbital geometry)
  * `size: 1.25` ( ajusted to `0.95` on mobile screens)
* Ensure foreground hero typography, badges, and CTA buttons sit inside a `.container.position-relative` with `z-index: 2` and a subtle radial glassmorphism backdrop so text meets WCAG AAA contrast over the rotating 3D globe.

### Mid-Page Call-to-Action / R&D Section (`#cta`) — `VANTA.CELLS`
Use **`VANTA.CELLS`** on the `#cta` banner section (replacing the legacy `#cta-energy-stream` canvas) to evoke cellular nutrition, bioavailability, and nutraceutical science:
* **Configuration**:
  * `el: "#cta"`
  * `mouseControls: true`, `touchControls: true`, `gyroControls: false`
  * `color1: 0x0d9488` (Botanical Teal)
  * `color2: 0xf59e0b` (Warm Vitamin Amber)
  * `size: 1.50`, `speed: 1.20`

### Performance & Lifecycle Safeguards
* Use an `IntersectionObserver` to pause/resume or manage Vanta instances when scrolled out of view and trigger `.resize()` on debounced window resize events so the page runs smoothly at 60 FPS on both desktop and mobile devices.

## 3. Preserved Contact Information, Assets & Legacy Hooks

Retain the following exact details and paths from the original website:

| Element | Exact Value to Preserve |
| :--- | :--- |
| **Company Legal Name** | `TPO Wellness Ltd.` |
| **Location** | `Bangkok, Thailand` |
| **Email Address** | `info@tpo-wellness.com` |
| **Phone Number** | `+66 87 789 4950` |
| **LINE Official Link** | `https://lin.ee/nW4iuoH` (with `<img src="assets/img/Tpo-line.png" alt="Connect on LINE">`) |
| **Logo & Favicons** | `./assets/img/TPOLogo.png`, `assets/img/favicon.png`, `assets/img/apple-touch-icon.png` |
| **Google Maps Iframe** | `https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d496115.3313133451!2d100.35290282935726!3d13.724699806600398!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x311d6032280d61f3%3A0x10100b25de24820!2sBangkok%2C%20Thailand!5e0!3m2!1sen!2sus!4v1691035652862!5m2!1sen!2sus` |
| **Google Apps Script Webhook** | `https://script.google.com/macros/s/AKfycbwJDAeDBi1-_iodvcl_4bFZ6HlFXouWRkZ0kiCOlj7g4lXbI6yXQsi33QjAVYMYKb09/exec` |
| **Existing Product SVG Paths** | `assets/img/products/pre-workout-elixir.svg`, `assets/img/products/post-workout-recovery.svg`, `assets/img/products/hydration-support.svg`, `assets/img/products/sleep-tonic.svg`, `assets/img/products/sexual-health.svg`, `assets/img/products/focus-memory.svg`, `assets/img/products/stress-management.svg`, `assets/img/products/immune-support.svg` (with clean CSS/SVG fallbacks if an image is missing) |

## 4. Section-by-Section Architecture & Content Requirements

### A. Top Bar (`#topbar`) & Sticky Header (`#header`)
* **Top Bar**: Display clickable `info@tpo-wellness.com`, `+66 87 789 4950`, a quick badge reading `"Thai FDA & GMP Certified OEM Facility — Bangkok, Thailand"`, and the `#loginStatus` span for logged-in staff.
* **Navbar (`#navbar`)**:
  * Logo: `<img src="./assets/img/TPOLogo.png" alt="TPO Wellness Logo" class="img-fluid">`.
  * Navigation Links: `Home (#hero)`, `About (#about)`, `OEM Gummies (#oem-gummies)`, `Formulations (#products)`, `Herbal Shop & Clinic (#herbal-clinic)`, `Request Quote & Book Meeting (#quote-booking)`, `Locations (stores.html)`, and `Contact (#contact)`.
  * **Header CTA Button**: A prominent `"Get a Quote / Book Call"` button scrolling to `#quote-booking`.
  * **Preserved Employee Portal Dropdown (`#employeePortalDropdown`) & Login Link (`#loginLogoutLink`)**: Keep the exact `localStorage` token authentication script (`tpoSessionToken`, `tpoGrantedTokens`, `tpoUserEmail`, `tpologin.html` / `tpologin-m.html`, `sales-only-user` class logic), but update the Sales Tools & Customer Portal dropdown labels to reflect the new business lines (`OEM Gummy Catalog`, `Custom Formulation Pricing`, `TPO Herbal Shop Inventory`, `Clinic Appointments`, `Performance`, `ERP`, `CRM`).

### B. Hero Section (`#hero`) with Interactive 3D Vanta Globe
* **Badge**: `"Bangkok's Premier GMP & Thai FDA Certified OEM Partner"`
* **Headline (`<h1>`)**: `"Turnkey White-Label Supplement Gummy Manufacturing in Thailand"`
* **Subheadline (`<h2>`)**: `"From High-Dose Creatine, Protein, Sleep & Relax Gummies to Custom Nutraceutical Formulations — Plus Our Signature TPO Herbal Shop & Thai Traditional Clinic."`
* **Dual CTAs**:
  * Primary Button: `"Request an OEM Quote"` (scrolls to `#quote-booking` with the Quote tab active).
  * Secondary Button: `"Schedule R&D Consultation"` (scrolls to `#quote-booking` with the Meeting Scheduler tab active).
* **Key Trust Metrics Bar**:
  * `Thai FDA & GMP Certified` | `Pectin, Gelatin & Sugar-Free R&D` | `Low MOQ & Global Export Ready` | `End-to-End Custom Packaging`

### C. About & Why Choose TPO Wellness (`#about`)
* Highlight TPO Wellness's Bangkok manufacturing headquarters and turnkey workflow:
  1. **Custom R&D & Flavor Engineering**: Pectin (100% vegan, heat-stable for tropical climates) and gelatin bases, natural fruit flavors, sugar-free/keto sweeteners, and active ingredient stability testing.
  2. **Thai FDA Approved & GMP Certified Facility**: Full regulatory compliance, Certificate of Analysis (CoA) lab testing, domestic Thai FDA registration, and international export documentation.
  3. **Integrated Wellness Ecosystem**: Uniquely combining modern nutraceutical science with authentic Thai botanical wisdom through our **TPO Herbal Shop** and licensed **Thai Traditional Clinic**.

### D. Core OEM Gummy & Supplement Capabilities (`#services` / `#oem-gummies`)
Create 6 interactive service cards:
1. **Creatine Performance Gummies**: High-bioavailability creatine monohydrate gummies (3g–5g per serving) engineered without gritty texture or moisture degradation.
2. **Protein & Amino Recovery Gummies**: Collagen, BCAAs, EAAs, and whey/plant protein gummies for convenient post-workout muscle repair.
3. **Sleep & Nighttime Recovery Gummies**: Melatonin-free or low-dose melatonin options blended with L-Theanine, Magnesium Glycinate, Chamomile, Reishi, and Chaga.
4. **Relax, De-Stress & Mood Gummies**: Ashwagandha, GABA, Rhodiola, Lemon Balm, and Thai adaptogenic herbs for calm focus and cortisol balance.
5. **Custom Supplement Formulations (Beyond Gummies)**: Tailored R&D for hydration electrolytes, nootropics (Lion's Mane), immunity, vitality, capsules, effervescent powders, and functional elixirs.
6. **Turnkey Branding, Packaging & FDA Registration**: Custom bottles, child-resistant mylar pouches, blister packs, label design, and end-to-end Thai FDA product registration.

### E. Filterable Product & Formulation Showcase (`#products`)
Use Isotope/JS filtering with updated categories:
* **Filter Tabs**: `All`, `OEM Gummies`, `Peak Performance & Recovery`, `Sleep, Relax & Mind`, `Herbal & Immunity`
* **Showcase Items (12 cards total)**:
  * **4 Flagship OEM Gummy Cards** (with rich CSS/SVG visual cards and spec badges like `"Vegan Pectin"`, `"Sugar-Free Option"`, `"Custom Flavor"`):
    1. *Creatine Power Gummies* (Strength & Cellular Energy — Berry/Citrus Burst)
    2. *Pro-Collagen & Amino Protein Gummies* (Muscle Recovery — Tropical Mango)
    3. *Deep Slumber Sleep Gummies* (L-Theanine, Magnesium & Botanical Extracts — Mixed Berry)
    4. *Zen Botanica Relax Gummies* (Ashwagandha & L-Theanine Stress Relief — Passionfruit Yuzu)
  * **8 Functional Supplement Cards** (preserving the existing SVG paths and links from the legacy portfolio):
    5. *Pre-Workout Supplement* — Lion's Peak Pre-Workout Elixir (`assets/img/products/pre-workout-elixir.svg`, `pre-workout.html`)
    6. *Post-Workout Recovery* — Reishi Restore Recovery Blend (`assets/img/products/post-workout-recovery.svg`, `post-workout.html`)
    7. *Hydration Support* — Himalayan Hydration Elixir / Hydro-Freeze Pops (`assets/img/products/hydration-support.svg`, `hydration-support.html`)
    8. *Sleep Support* — Chill Chaga Nighttime Tonic (`assets/img/products/sleep-tonic.svg`, `sleep-support.html`)
    9. *Vitality & Wellness* — Tribulus Vitality Lift (`assets/img/products/sexual-health.svg`, `sexual-health.html`)
    10. *Focus & Memory* — Lion's Mane Mind Fuel (`assets/img/products/focus-memory.svg`, `focus-memory.html`)
    11. *Stress Management* — Adaptogen Zen Balance Blend (`assets/img/products/stress-management.svg`, `stress-management.html`)
    12. *Immune Support* — Mushroom Defense Immune Shield (`assets/img/products/immune-support.svg`, `immune-support.html`)
* Every product card must include a `"Request Sample / Quote"` button that pre-selects that product in the Quote Request form below.

### F. Dedicated Section: TPO Herbal Shop & Thai Traditional Clinic (`#herbal-clinic`)
Replace the legacy cannabis "Where to Buy" section with a two-column showcase highlighting TPO Wellness's consumer and clinical divisions:
* **Column 1 — TPO Herbal Shop**:
  * Showcases authentic Thai herbal remedies, standardized botanical extracts, functional mushroom tonics, and natural wellness products.
  * Includes a CTA linking to `stores.html` (`"Explore Shop Locations & Retail Partners"`).
* **Column 2 — Thai Traditional Clinic**:
  * Highlights licensed Thai Traditional Medicine (TTM) practitioners in Bangkok offering personalized herbal prescriptions, holistic diagnostics, stress/sleep restoration, and traditional therapeutic care.
  * Includes a CTA button (`"Book a Clinic or Herbal Consultation"`) that scrolls to the Meeting Scheduler and selects `"Thai Traditional Clinic / Herbal Shop Inquiry"`.

### G. Interactive "Request a Quote" & "Schedule a Meeting" Hub (`#quote-booking`)
Build a high-conversion, tabbed dual-action interactive module compatible with **GitHub Pages** and wired directly to the existing Google Apps Script endpoint (`https://script.google.com/macros/s/AKfycbwJDAeDBi1-_iodvcl_4bFZ6HlFXouWRkZ0kiCOlj7g4lXbI6yXQsi33QjAVYMYKb09/exec`):

* **Tab 1: Request an OEM / White-Label Quote (`action: "quote_request"`)**
  * **Contact Fields**: Full Name, Company / Brand Name, Work Email, Phone / WhatsApp / LINE ID, Country.
  * **Product Category Selector (Checkboxes/Pills)**: `Creatine Gummies`, `Protein Gummies`, `Sleep Gummies`, `Relax / Stress Gummies`, `Custom Gummy Formulation`, `Other Functional Supplement (Powder/Capsule/Elixir)`, `Herbal Bulk Supply`.
  * **Formulation Specifications**:
    * Base Preference: `Vegan Pectin (Heat-Stable)`, `Gelatin`, `Agar / Carrageenan`, `Need R&D Recommendation`
    * Sweetener Profile: `Sugar-Free (Maltitol/Allulose/Stevia)`, `Organic Cane Sugar / Glucose`, `Custom`
    * Packaging Format: `Custom Printed Pouches (Mylar)`, `PET / HDPE Supplement Bottles`, `Glass Jars`, `Bulk Unpackaged Gummies`
    * Estimated Order Volume (MOQ Tier): `Pilot Run (3,000 – 5,000 units)`, `Growth Run (10,000 – 25,000 units)`, `Scale Production (50,000+ units)`, `Bulk By Weight (kg)`
  * **Project Details / Active Ingredients**: Textarea for target active ingredients per serving, flavor preferences, and target launch timeline.

* **Tab 2: Schedule a Meeting / R&D Discussion (`action: "schedule_meeting"`)**
  * **Meeting Type Selector**:
    * `OEM / White-Label R&D Discovery Call (30 Min Video)`
    * `Bangkok Factory Tour & Gummy Sample Tasting (In-Person)`
    * `TPO Herbal Shop & Thai Traditional Clinic Partnership / Consultation`
  * **Interactive Date & Time Picker**:
    * Date input (restricting past dates) + Time Slot selector in **Bangkok Time (ICT / UTC+7)** (e.g., `09:30`, `11:00`, `14:00`, `15:30`, `17:00 ICT`) with a live JavaScript helper that automatically displays the visitor's detected local timezone alongside Bangkok time.
  * **Preferred Meeting Platform**: `Google Meet`, `Zoom`, `Microsoft Teams`, `LINE Call`, `In-Person (Bangkok Office/Factory)`.
  * **Attendee Details & Agenda**: Name, Email, Phone/LINE ID, Company, and Discussion Topics.
  * **Instant Calendar Action**: Upon form submission (via `fetch` with `mode: 'no-cors'` to the Google Apps Script URL), display a confirmation card with a dynamically generated **"Add to Google Calendar"** link and **"Download `.ics` Calendar Invite"** button so the client immediately locks in the time slot, plus a direct **LINE Official Account (`https://lin.ee/nW4iuoH`)** quick-chat button.

### H. Contact & Bangkok Location Section (`#contact`) & Footer (`#footer`)
* **Contact Info Boxes**:
  * **Address**: `TPO Wellness Ltd. — Bangkok, Thailand` (OEM Manufacturing Facility, Herbal Shop & Thai Traditional Clinic).
  * **Email**: `info@tpo-wellness.com`
  * **Phone**: `+66 87 789 4950`
  * **LINE Official**: Clickable `https://lin.ee/nW4iuoH` QR/button using `assets/img/Tpo-line.png`.
* **Google Maps Embed & Quick General Contact Form (`#contactForm`)**: Preserve the Bangkok Google Maps `<iframe>` alongside the general `#contactForm` and footer `#newsletterForm`, both submitting via the unified Google Apps Script handler.

## 5. Visual Design, Styling & Technical Constraints

1. **Color Palette & Aesthetic**:
   * Transition from the old dark cannabis theme to a clean, clinical-meets-botanical luxury palette:
     * **Primary Brand Emerald/Teal**: `#0d9488` / `#10b981` (Science, Vitality, Herbal Purity)
     * **Deep Biopharma Navy (Hero/CTA/Footer dark surfaces)**: `#071a1e` / `#0f172a`
     * **Warm Gummy/Botanical Amber Accent**: `#f59e0b`
     * **Clean Clinical Light Surfaces**: `#f8fafc` and `#ffffff` with subtle glassmorphic cards (`backdrop-filter: blur(12px)`) and soft shadows.
2. **GitHub Pages Readiness**:
   * Use relative asset paths (`./assets/...` or `assets/...`) so the repository works whether deployed at a root custom domain (`tpo-wellness.com`) or a GitHub Pages project subpath (`username.github.io/tpo-wellness/`).
   * Include all custom CSS inside a well-organized `<style>` block (or modular CSS section) so the revamped design works immediately even before modifying external `assets/css/style.css`.
   * Output the complete, valid, un-truncated HTML file with zero placeholders (`// TODO` or `...`).

## 6. Implementation Changelog

### 2026-10-29 — Manufacturing capability card imagery

* `index.html` now includes lazy-loaded, 8:5 image panels on all seven `#services` capability cards, with descriptive alt text and reference-image captions.
* Existing gummy photos are reused for texture/format references. Apple, chamomile, and reishi photos are locally hosted WebP derivatives; source, author, license, and modification credits are available under “Reference imagery & photo credits” in the section.
* `assets/img/services/packaging-formats.svg` is an original bottle/pouch/sachet illustration, not an approved-label or certification image. The packaging card spans the full row with a split layout from 768px upward and stacks below that width.
* Existing quote-button categories and handlers are unchanged. The packaging category has no matching quote pill and retains the existing “Custom Gummy Formulation” fallback.
