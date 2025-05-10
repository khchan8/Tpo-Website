# Plan: "Where to Buy" Feature Implementation (Revised 2025-05-10)

## 1. Product Requirements Document (PRD)

### 1.1. Introduction & Goals

*   **Project:** Implement a "Where to Buy" feature on the TPO Wellness website.
*   **Goal:** Provide users with an easy way to find retail locations (dispensaries, clinics) where TPO Wellness's customer products are sold. Enhance user experience by centralizing store information, improving accessibility to products, and providing a professional, organized interface.
*   **User Stories:**
    *   As a website visitor, I want to easily find a list of stores that sell TPO Wellness products so I can purchase them.
    *   As a website visitor, I want to see key details for each store, such as address, phone number, operating hours, and a map link, so I can plan my visit.
    *   As a website visitor, I want the store listing page to have a consistent look and feel with the rest of the TPO Wellness website.
    *   As a website visitor, I want to quickly see all available store names at the top of the page and click to navigate to their details.
    *   As a website visitor, I want to see chain stores grouped together, with the ability to expand/collapse these groups to view individual branches.

### 1.2. Scope & Features

*   **1.2.1. `index.html` Modification:**
    *   A new section titled "Where to Buy Our Products" (or similar) will be added to the main page (`index.html`).
    *   This section will be placed between the existing "Products" section and the "Team" section.
    *   It will contain a brief introductory text and a clear call-to-action (CTA) button/link (e.g., "Find a Store," "View All Locations") that navigates to a new dedicated store listing page (`stores.html`).
    *   The styling of this new section should be consistent with the existing design of `index.html`.

*   **1.2.2. New Store Listing Page (`stores.html`):**
    *   A new HTML file named `stores.html` will be created.
    *   **Layout & Theme:**
        *   The page will use the same header (navigation bar), footer, and overall CSS styling as `index.html` to ensure visual consistency.
        *   The `<title>` of the page will be descriptive (e.g., "Store Locations - TPO Wellness").
    *   **Content - Top-Level Store Index:**
        *   At the top of the page, a list of all unique store names (and chain group names) will be displayed.
        *   Each name will be an anchor link, allowing users to click and jump directly to the corresponding store card or group on the page.
    *   **Content - Store Listings & Grouping:**
        *   The page will display a list of all partner stores/chains.
        *   **Store Groups (Accordion):** Stores belonging to a chain (e.g., "Greenhead Clinic," "Siam Green") will be grouped under a main chain heading. These groups will function as accordions (expandable/collapsible sections) to show or hide individual branch listings.
        *   Each individual store (or branch within a group) will be presented in a clear, organized card format.
        *   **Information to display for each store/branch:**
            *   Store/Branch Name
            *   Full Address
            *   Phone Number
            *   Operating Hours (if available)
            *   Line Messenger ID/Link (if available)
            *   Link to Google Maps for the store's address.
            *   One representative Store Image (sourced from `assets/img/stores/`).
            *   Other important information (e.g., brief description, specific product focus, if available).
    *   **Data Source:** Information will be extracted from `.html` files (for stores not yet converted) and `.txt` files (for stores with simplified data) located in the `shops/` directory. All images will be sourced from the `assets/img/stores/` directory.
    *   **Presentation:** The store listings, index, and accordions should be responsive and adapt well to different screen sizes.

*   **1.2.3. Data Extraction & Processing:**
    *   A process (manual or scripted) will be used to parse the `.html` and `.txt` data files in the `shops/` directory.
    *   The process will identify and extract the required pieces of information for each store.
    *   **Image Handling:**
        *   All store images must be moved from `shops/[StoreName]_files/` subdirectories to a new, centralized folder: `assets/img/stores/`.
        *   Image paths in the `stores.html` will point to this new central location (e.g., `assets/img/stores/StoreName_image.jpg`).
    *   An intermediate structured format (e.g., JSON, or well-commented HTML snippets per store/group) is recommended.

### 1.3. Design & UI/UX Considerations

*   **Consistency:** Maintain existing website branding.
*   **Clarity:** Information should be easy to read.
*   **Usability:**
    *   Map links open in new tabs.
    *   Phone numbers clickable (`tel:` links).
    *   The top-level store index provides quick navigation.
    *   Accordion groups for chains should be intuitive to use (clear expand/collapse indicators).
*   **Image Display:**
    *   Images in store cards must be displayed at a uniform size or aspect ratio for a clean, professional look (achieved via CSS).
    *   Placeholder images if an image is missing.

### 1.4. Technical Considerations

*   **HTML Structure:** Semantic and well-structured for content, index, and accordions.
*   **CSS:** New CSS rules in `assets/css/style.css` for:
    *   Store cards, images (uniform sizing/aspect ratio), info, map buttons.
    *   Top-level store index list.
    *   Accordion styling for store groups (headers, content areas, expand/collapse icons).
*   **Responsiveness:** All new elements must be fully responsive.
*   **JavaScript (for Accordions):** Basic JavaScript might be needed for accordion functionality if not using a CSS-only approach or a Bootstrap component (if Bootstrap JS is already in use and suitable).

### 1.5. Non-Goals (Out of Scope for this iteration)

*   Dynamic database integration.
*   User accounts for store owners.
*   Advanced search/filtering beyond the top-level index and browser search.
*   Automated scraping scripts.

---

## 2. Step-by-Step Implementation Plan (for the Coder)

### Phase 0: Setup & Preparation

1.  **Familiarize:** Review `index.html`, `assets/css/style.css`.
2.  **Image Asset Consolidation:**
    a.  Create the directory `assets/img/stores/`.
    b.  **Manually move all relevant store images** from the various `shops/[StoreName]_files/` subdirectories into the new `assets/img/stores/` directory. Rename images if necessary for clarity (e.g., `StoreName_BranchName_image1.jpg`). This step is crucial and must be completed before or during Phase 1 data structuring.
3.  **Asset Review:** Examine the contents of the `shops` directory (HTML and TXT files) and the consolidated `assets/img/stores/` directory.

### Phase 1: Data Extraction and Structuring

*   **Objective:** Extract all required information for each store/branch (textual data from `.html` or `.txt` files, and image paths from `assets/img/stores/`) and organize it, noting chain affiliations.
*   **Tools:** Text editor, browser developer tools.

1.  **Iterate Through Stores/Chains:** For each store or chain:
    a.  **Identify Data Source(s):** Determine if data comes from a single `.txt` file, multiple `.txt` files (for chains), an `.html` file, or a combination. Refer to "Section 3: Source Files" for the list.
    b.  **Open & Inspect:**
        *   For `.html` files: Open in browser/editor.
        *   For `.txt` files: Open in editor.
    c.  **Extract Textual Data:** (Store Name, Branch Name (if applicable), Address, Phone, Hours, Line ID, Google Maps Link, Description, etc.)
    d.  **Identify Image Path(s):** For each store/branch, note the corresponding image filename(s) now located in `assets/img/stores/`.
    e.  **Store Extracted Data (Intermediate Representation):**
        *   Create a structured representation (e.g., JSON objects within an array, or detailed HTML comment blocks).
        *   **Crucially, group data for chains.** For example:
            ```json
            [
              {
                "groupName": "Greenhead Clinic",
                "isChain": true,
                "branches": [
                  { "name": "Greenhead Clinic (Main Information)", "address": "...", "phone": "...", "image": "assets/img/stores/Greenhead_Main_home-01.jpg", ... },
                  { "name": "Greenhead Clinic Phuket Town", "address": "Phuket province", "phone": "088-891-9149", "image": "assets/img/stores/Greenhead_PhuketTown_ourclinic-02.jpg", ... },
                  // ... other Greenhead branches
                ]
              },
              {
                "groupName": "Siam Green",
                "isChain": true,
                "branches": [
                  { "name": "Siam Green Cannabis Co (Nana)", "address": "...", "phone": "...", "image": "assets/img/stores/SiamGreen_Nana_SiamGreenNana.jpg", ... },
                  { "name": "Siam Green Koh Samui Cannabis Dispensary", "address": "...", "image": "assets/img/stores/SiamGreen_KohSamui_SiamGreenKohSamui.jpg", ... },
                  { "name": "Siam Green Chinatown Cannabis Dispensary", "address": "...", "image": "assets/img/stores/SiamGreen_Chinatown_SiamGreenChinatown.jpg", ... },
                  // ... other Siam Green branches from TXT files
                ]
              },
              {
                "name": "California's Finest", // Standalone store
                "isChain": false,
                "address": "760/3 Sukhumvit road Bangkok, Thailand",
                "phone": "0649962888",
                "image": "assets/img/stores/CaliforniasFinest_CaliforniasFinest.jpg",
                // ... other details
              },
              // ... other standalone stores and chains
            ]
            ```
    f.  **Extracted Store Data (Summary for Plan - To be updated based on actual extraction):**

        **Chain: Greenhead Clinic**
        *   **Source Files:** `shops/Greenhead Clinic.html` (Main info), branch details from `store_data_extraction_progress.md`
        *   **Main Clinic Information:**
            *   Description: Greenhead Clinic specializes in traditional and alternative medicinal use of hemp and cannabis.
            *   Main Phone: +66 (0) 98 289 0024
            *   Main Email: info@greenheadclinic.com
            *   Main Website: `https://www.greenheadclinic.com`
            *   Main Facebook: `https://www.facebook.com/greenheadclinic.th`
            *   Main Line ID: `@greenheadclinic` (Link: `https://line.me/ti/p/~@greenheadclinic`)
            *   Main Instagram: `https://www.instagram.com/greenheadclinic/`
            *   Main YouTube: `https://www.youtube.com/@greenheadclinic164`
            *   Generic OG Image: `assets/img/stores/Greenhead_Main_home-01.jpg` (from `shops/Greenhead Clinic_files/home-01.jpg`)
            *   Favicon: `assets/img/stores/Greenhead_Favicon_favicon.png` (from `shops/Greenhead Clinic_files/favicon.png`)
        *   **Branches:**
            1.  **Greenhead Clinic Phuket Town**
                *   Province: Phuket province
                *   Contact: 088-891-9149
                *   Hours: Mon-Sat 10:00 AM – 08:00 PM; Sun 12:00 PM – 10:00 PM
                *   Map: `https://goo.gl/maps/J8gM2VBKWfF7q1Dm8`
                *   Image: `assets/img/stores/Greenhead_PhuketTown_ourclinic-02.jpg` (from `shops/Greenhead Clinic_files/ourclinic-02.jpg`)
            2.  **Greenhead Clinic Kamala**
                *   Province: Phuket Province
                *   Contact: *Not specified*
                *   Hours: 01:00 PM – 11:00 PM (Closed on Friday)
                *   Map: `https://goo.gl/maps/L1bXzgLgpvVJfL5y7`
                *   Image: `assets/img/stores/Greenhead_Kamala_ourclinic-01.jpg` (from `shops/Greenhead Clinic_files/ourclinic-01.jpg`)
            3.  **Greenhead Clinic Kata**
                *   Province: Phuket province
                *   Contact: 065-464-1003
                *   Hours: 10:00 AM – 11:00 PM
                *   Map: `https://goo.gl/maps/Wb3i3iXyD1ciG3wn9`
                *   Image: `assets/img/stores/Greenhead_Kata_ourclinic-phuket-kata.jpg` (from `shops/Greenhead Clinic_files/ourclinic-phuket-kata.jpg`)
            4.  **Greenhead Clinic Andaman**
                *   Province: Phuket province
                *   Contact: 096 238 2227
                *   Hours: 10:00 AM – 12:00 AM (midnight)
                *   Map: `https://maps.app.goo.gl/n8j3uKam16NWhFSK7`
                *   Image: `assets/img/stores/Greenhead_Andaman_ourclinic-andaman.jpg` (from `shops/Greenhead Clinic_files/ourclinic-andaman.jpg`)
            5.  **Greenhead Clinic Chaweng Samui**
                *   Province: Surathani province
                *   Contact: 082 629 7863
                *   Hours: 12:00 PM – 02:00 AM (Adjusted from 12AM-2AM, assuming PM start)
                *   Map: `https://goo.gl/maps/476X22rEZqmNp75Q7`
                *   Image: `assets/img/stores/Greenhead_ChawengSamui_ourclinic-surat-chaweng.jpg` (from `shops/Greenhead Clinic_files/ourclinic-surat-chaweng.jpg`)
            6.  **Greenhead Clinic Aonang**
                *   Province: Krabi province
                *   Contact: 065-605-2195
                *   Hours: 01:00 PM – 11:00 PM
                *   Map: `https://maps.app.goo.gl/KgdsnFKCLuZHNrHq8`
                *   Image: `assets/img/stores/Greenhead_Aonang_ourclinic-krabi-aonang.jpg` (from `shops/Greenhead Clinic_files/ourclinic-krabi-aonang.jpg`)
            7.  **Greenhead Clinic Nimman**
                *   Province: Chiang Mai province
                *   Contact: 065 563 2326
                *   Hours: 10:00 AM – 01:00 AM
                *   Map: `https://goo.gl/maps/A936JccFPKEHP4926`
                *   Image: `assets/img/stores/Greenhead_Nimman_ourclinic-01.jpg` (from `shops/Greenhead Clinic_files/ourclinic-01.jpg` - reused)
            8.  **Greenhead Clinic Khaosan Road**
                *   Province: Bangkok province
                *   Contact: 083-826-4166
                *   Hours: 12:00 PM – 02:00 AM
                *   Map: `https://goo.gl/maps/oByw5o1xSqdDUZzi8`
                *   Image: `assets/img/stores/Greenhead_KhaosanRoad_ourclinic-bangkok-kaosang.jpg` (from `shops/Greenhead Clinic_files/ourclinic-bangkok-kaosang.jpg`)
            9.  **Greenhead Clinic Silom**
                *   Address: Silom Complex, B08, B Floor, 191 Silom Rd, Silom, Bang Rak, Bangkok 10500
                *   Contact: *Not specified*
                *   Hours: 11:00 AM – 10:00 PM (Closed on Monday)
                *   Map: `https://goo.gl/maps/jLu4W7LJkJkV2LdV8`
                *   Image: `assets/img/stores/Greenhead_Silom_ourclinic-bangkok-Silom.jpg`
            10. **Greenhead Clinic China Town (Branch)** (*Note: Distinguish from Siam Green Chinatown*)
                *   Province: Bangkok province
                *   Contact: 089-030-3300
                *   Hours: 10:00 AM – 02:00 AM
                *   Map: `https://goo.gl/maps/DPcXiLSSVy6Zc47f7`
                *   Image: `assets/img/stores/Greenhead_ChinaTownBranch_ourclinic-bangkokchina-town.jpg` (from `shops/Greenhead Clinic_files/ourclinic-bangkokchina-town.jpg`)
            11. **Greenhead Clinic Pattaya Sai 2**
                *   Province: Chonburi province
                *   Contact: 093-964-6646
                *   Hours: 11:00 AM – 10:00 PM (Closed on Monday)
                *   Map: `https://goo.gl/maps/ogGZVVjm4GXtQNz18`
                *   Image: `assets/img/stores/Greenhead_PattayaSai2_ourclinic-pattaya-PattayaSai2.jpg` (from `shops/Greenhead Clinic_files/ourclinic-pattaya-PattayaSai2.jpg`)
            12. **Greenhead Clinic Jomtien, Pattaya**
                *   Province: Chonburi province
                *   Contact: 092-626-2659
                *   Hours: 04:00 PM – 01:00 AM
                *   Map: `https://maps.app.goo.gl/YDFZzjJmEJqs2hGm9`
                *   Image: `assets/img/stores/Greenhead_Jomtien_ourclinic-pattaya-South-Pattaya.jpg` (from `shops/Greenhead Clinic_files/ourclinic-pattaya-South-Pattaya.jpg`)

        **Chain: Siam Green**
        *   **Source Files:** `shops/Siam Green Cannabis Co (Nana).txt`, `shops/Siam Green Koh Samui Cannabis Dispensary.txt`, `shops/Siam Green Phrom Phong, Sukhumvit Dispensary.txt`, `shops/SiamGreen Sala Daeng, Silom Dispensary.txt`, `shops/Siam Green Chinatown.txt`
        *   **Branches:**
            1.  **Siam Green Cannabis Co (Nana)**
                *   Address: 210 Sukhumvit Rd, Khlong Tan, Khlong Toei, Bangkok 10110
                *   Phone: 0617805531
                *   Operating Hours: Open Everyday 11 am–3 am
                *   Google Maps Link: `https://www.google.com/maps/place/Siam+Green+Cannabis+Co+Nana+Weed+Shop/@13.7303079,100.5701416,15z/data=!4m6!3m5!1s0x30e29febecd82907:0x56fb9211f41e92c6!8m2!3d13.7385735!4d100.5578553!16s%2Fg%2F11v3nmnty6?entry=tts`
                *   Image: `assets/img/stores/SiamGreen_Nana.jpg` (Example)
            2.  **Siam Green, Koh Samui, Chaweng Cannabis Dispensary**
                *   Address: 200/8, Chaweng Beach Road, Bo Put, Ko Samui
                *   Operating Hours: Open Everyday 11 am–3 am
                *   Google Maps Link: (Use link from TXT file)
                *   Image: `assets/img/stores/SiamGreen_KohSamui.jpg` (Example)
            3.  **Siam Green Phrom Phong, Sukhumvit Dispensary**
                *   Address: 663 Sukhumvit Rd, Khwaeng Khlong Tan Nuea, Watthana, Bangkok 10110
                *   Phone: 096-893-0545
                *   Email: info@siamgreenco.com
                *   Operating Hours: Open Everyday 11 am–3 am
                *   Landmarks: Emquartier, Emporium, Phrom Phong BTS
                *   Image: `assets/img/stores/SiamGreen_PhromPhong.jpg` (Example)
            4.  **SiamGreen Sala Daeng, Silom Dispensary**
                *   Address: 18 Silom Road, Silom, Bang Rak, Bangkok 10110
                *   Phone: 096-403-4198
                *   Email: info@siamgreenco.com
                *   Operating Hours: Open Everyday 11 am–3 am
                *   Landmarks: Silom Complex, Patpong, Sala Daeng BTS
                *   Image: `assets/img/stores/SiamGreen_SalaDaeng.jpg` (Example)
            5.  **Siam Green Chinatown Cannabis Dispensary** (Name adjusted for clarity)
                *   Source File: `shops/Siam Green Chinatown.txt`
                *   Address: 325 Maha Chai Rd, Samran Rat, Phra Nakhon, Bangkok
                *   Phone: 0981273004
                *   Google Maps Link: (Use link from TXT file)
                *   Image: `assets/img/stores/SiamGreen_Chinatown.jpg`

        **Standalone Store: California's Finest**
        *   **Source File:** `shops/CaliforniasFinest.txt`
        *   **Store Name:** California's Finest
        *   Instagram: `@californiasfinest_official` (`https://www.instagram.com/californiasfinest_official/`)
        *   Address: 760/3 Sukhumvit road Bangkok, Thailand
        *   Phone: 0649962888
        *   Other Instagram (Bar): `@californiasfinest_bar`
        *   Linktree: `https://linktr.ee/californiafinest`
        *   Operating Hours: *Not specified in source*
        *   Google Maps Link: `https://www.google.com/maps/search/?api=1&query=760/3+Sukhumvit+road+Bangkok+Thailand` (Generated from address)
        *   Image: `assets/img/stores/CaliforniasFinest.jpg`

        **Standalone Store: CannaStock**
        *   **Source File:** `shops/CannaStock.txt`
        *   Address: Bangna, Bangkok, Bangkok, Thailand, Bangkok
        *   Phone: 083 201 6605
        *   Image: `assets/img/stores/CannaStock.jpg` (Example)

        **Standalone Store: Slimjim Strains Cannabis & Weed Dispensary**
        *   **Source File:** `shops/Slimjim Strains Cannabis & Weed Dispensary.txt`
        *   Address: 4876 Rama IV Rd, Phra Khanong, Khlong Toei, Bangkok 10110
        *   Phone: 093 002 2278
        *   Image: `assets/img/stores/SlimjimStrains.jpg` (Example)

        **Chain: Stoned & Co.** (*Assuming this might be a chain based on "Co. Ltd." - adjust if standalone*)
        *   **Source File:** `shops/Stoned & Co Co. Ltd.txt`
        *   **Branches:**
            1.  **Stoned & Co. Thailand (Thong Lo)**
                *   Address: 2nd Floor, Seenspace Thong Lo 13, Sukhumvit 55 Rd., Vadhana, Bangkok, Thailand, Bangkok
                *   Phone: 083 464 5108
                *   Email: hello@stonedandcothailand.com
                *   Google Maps Link: `goo.gl/maps/cfZe9sPk99vNGeWi6`
                *   Image: `assets/img/stores/StonedAndCo_ThongLo.jpg` (Example, using `Stoned & Co Co. Ltd.jpg` from `_files` dir)

        **Standalone Store: Strainz Dispensary**
        *   **Source File:** `shops/Strainz Dispensary.txt`
        *   Address: 8 Soi Sukhumvit 63, Phra Khanong Nuea, Watthana, Bangkok 10110
        *   Phone: 099 624 7774
        *   Line Link: `https://lin.ee/HjFEzzs`
        *   Image: `assets/img/stores/StrainzDispensary.jpg` (Example)
    
            **Chain: High Society Cannabis Club Thailand**
            *   **Source File:** `shops/High Society Cannabis Club Thailand.txt`
            *   **Website:** `https://www.highsociety-thailand.com/`
            *   **Branches:**
                1.  **High Society - SUKHUMVIT 31**
                    *   Address: Sawasdee, 245/14 Soi Sukhumvit 31, Khlong Toei Nuea, Watthana, Bangkok 10110
                    *   Google Maps Link: (Extract from "Get Direction" if possible, otherwise use address for search query)
                    *   Image: `assets/img/stores/HighSociety_SUKHUMVITS.png`
                2.  **High Society - SUAN PLU**
                    *   Address: 313/2 Suanplu 1 Sathorn Road Thung Maha Mek, Sathon, Bangkok 10120
                    *   Google Maps Link: (Extract from "Get Direction" if possible, otherwise use address for search query)
                    *   Image: `assets/img/stores/HighSociety_SUANPLU.png`
                3.  **High Society - HUA LAMPHONG**
                    *   Address: 23 34-35 Tri Mit Rd, Talat Noi, Samphanthawong, Bangkok 10100
                    *   Google Maps Link: (To be generated from address)
                    *   Image: `assets/img/stores/HighSociety_HuaLamPhong.png`
                4.  **High Society - KOH PHANGAN**
                    *   Address: 78, Ban Tai, Ko Phangan, Surat Thani 84280
                    *   Google Maps Link: (Extract from "Get Direction" if possible, otherwise use address for search query)
                    *   Image: `assets/img/stores/HighSociety_PHANGAN.png`
    
            **Chain: Cannabis Twins Bangkok**
            *   **Source File:** `shops/Cannabis Twins Bangkok.html` (and user feedback)
            *   **Website:** `https://www.cannabistwins.com/`
            *   **Main Email:** `cannabistwinsth@gmail.com`
            *   **Main Phone:** `+66 82-420-4266`
            *   **Main LINE:** `@cannabistwins` (Link: `https://page.line.me/cannabistwins`)
            *   **General Hours:** 10 am - 2 am daily
            *   **Description:** Cannabis Twins is a friendly cannabis dispensary in Bangkok, Thailand that sells top-quality cannabis flowers, CBD and THC infused edibles and cannabis accessories.
            *   **Branches:**
                1.  **Cannabis Twins - Sala Daeng Location**
                    *   Address: 69/2 Sala Daeng Soi 3, Silom, Bang Rak, Bangkok 10500
                    *   Proximity: BTS Sala Daeng 300 meters from the top of Sala Daeng
                    *   Parking: MK Gold - 11 am to 9 pm (฿50/hour); Local market (top of soi) - 5 pm to 12 am (฿100 flat)
                    *   Operating Hours: Monday - Friday 10 am - 2 am; Weekends 10 am - 2 am
                    *   Google Maps Link: `https://maps.google.com/maps?ll=13.7262949,100.5371712&z=16` (Existing link, verify if still accurate)
                    *   Image: `assets/img/stores/CannabisTwins_SalaDaeng.jpg`
                2.  **Cannabis Twins - Phloen Chit Location**
                    *   Address: 11/17 Woodberry Common, 4th Floor, Ruamrudee Rd., Lumpini, Pathum Wan, Bangkok 10330
                    *   Proximity: BTS Phloen Chit 150 meters from the top of Ruamrudee
                    *   Parking: Onsite across from the store
                    *   Operating Hours: Monday - Friday 10 am - 2 am; Weekends 10 am - 2 am
                    *   Google Maps Link: `https://maps.google.com/maps?ll=13.7407196,100.5501722&z=16` (Existing link, verify if still accurate)
                    *   Image: `assets/img/stores/CannabisTwins_PhloenChit.webp`
    
            **Standalone Store: Sawadee Sativa**
            *   **Source File:** `shops/Sawadee Sativa _ Premium Cannabis _ Weed Shop in Bangkok.html`
            *   **Website:** `https://sawadeesativa.com/`
            *   **Description:** Sawadee Sativa is a Weed Dispensary in Bangkok offering high-quality cannabis products like strains, high-THC favorites & smoking accessories. Conveniently located right across from Central World in the vibrant Pathum Wan district and just steps from the Saen Saep Canal.
            *   **Address:** 3 Chaloem Loke Bridge , Ratchadamri Road Level1, Room D Lumphini, Pathum Wan, Bangkok 10330
            *   **Phone:** `+6685-194-5151`
            *   **Facebook:** `https://facebook.com/sawadeesativa`
            *   **Instagram:** `https://www.instagram.com/sawadeesativa`
            *   **Google Maps Link:** `https://maps.google.com/maps?ll=13.749062,100.541098&z=16&t=m&hl=en-US&gl=US&mapclient=embed&cid=1044279022097495627`
            *   **Image:** `assets/img/stores/SawadeeSativa_image.jpg` (Placeholder - Coder to identify actual image, e.g., `https://sawadeesativa.com/wp-content/uploads/2024/11/banner-03.jpg` or from `shops/Sawadee Sativa _ Premium Cannabis _ Weed Shop in Bangkok_files/Photoshoot.jpeg`)
    
    2.  **Consolidate Data:** Ensure all structured data is ready.

### Phase 2: Create `stores.html` Page

1.  **File Creation & Basic Structure:** (Verify header/footer links, especially "Store Locations" nav link).
2.  **Top-Level Store Index:**
    a.  Before the main store listing section (`<section id="store-listings">`), create a `div` for the index (e.g., `<div id="store-index" class="container mb-4">`).
    b.  Inside this `div`, create an unordered list (`<ul>`).
    c.  For each unique chain group name (e.g., "Greenhead Clinic", "Siam Green") and each standalone store name from your consolidated data, add a list item (`<li>`) containing an anchor link (`<a>`).
        *   Example for a chain: `<li><a href="#group-greenhead">Greenhead Clinic</a></li>`
        *   Example for a standalone store: `<li><a href="#store-californiasfinest">California's Finest</a></li>`
3.  **Main Content Area for Stores (Accordion Structure for Chains):**
    a.  Inside `<section id="store-listings">`'s `<div class="container">`, before the `<div class="row gy-4">` that will hold standalone cards, iterate through chain groups.
    b.  **For Chains (e.g., Greenhead Clinic, Siam Green):**
        *   Create a main `div` for the chain group with an ID for the anchor link from the index (e.g., `<div class="store-group mb-5" id="group-greenhead">`).
        *   Inside, add a group header that also acts as the accordion trigger (e.g., `<h2><a data-bs-toggle="collapse" href="#collapse-greenhead" role="button" aria-expanded="false" aria-controls="collapse-greenhead">Greenhead Clinic <i class="bi bi-chevron-down"></i></a></h2>`).
        *   Create the collapsible `div` (e.g., `<div class="collapse" id="collapse-greenhead"><div class="row gy-4">...</div></div>`).
        *   For each branch in the chain, create a store card (as per step 3.d below) and append it inside the `row` of the collapsible `div`.
    c.  **For Standalone Stores:**
        *   These will go into the main `<div class="row gy-4" data-aos="fade-up" data-aos-delay="100">` (or a new row if preferred for separation).
        *   Each standalone store card should have an `id` if it's linked from the top-level index (e.g., `id="store-californiasfinest"` on the `div.store-card` or its `div.col-lg-4` parent).
    d.  **Store Card HTML (per store/branch):**
        ```html
        <div class="col-lg-4 col-md-6 store-item-col" data-aos="zoom-in" data-aos-delay="[INCREMENTAL_DELAY]">
          <div class="store-card" id="[UNIQUE_ID_FOR_BRANCH_IF_NEEDED_FOR_DEEP_LINKING_MAYBE_NOT_PRIMARY_FOCUS]">
            <div class="store-image">
              <img src="assets/img/stores/[IMAGE_FILENAME]" alt="[STORE_OR_BRANCH_NAME]" class="img-fluid">
            </div>
            <div class="store-info">
              <h4>[STORE_OR_BRANCH_NAME]</h4>
              <p><strong>Address:</strong> [ADDRESS]</p>
              <p><strong>Phone:</strong> <a href="tel:[PHONE_NUMBER_CLEAN]">[PHONE_NUMBER_DISPLAY]</a></p>
              <p><strong>Hours:</strong> [HOURS]</p>
              <p><strong>Line ID/Link:</strong> [LINE_ID_OR_LINK_HTML]</p>
              <!-- Other details -->
              <p><a href="[GOOGLE_MAPS_LINK_OR_GENERATED_QUERY]" target="_blank" class="btn-map">View on Google Maps</a></p>
            </div>
          </div>
        </div>
        ```
4.  **Styling (`assets/css/style.css`):**
    a.  Add/refine styles for `.store-card`, `.store-image` (ensure uniform sizing, e.g., `max-height: 200px; object-fit: cover; width: 100%;`), `.store-info`, `.btn-map`.
    b.  Style `#store-index ul` and `#store-index li a`.
    c.  Style `.store-group h2 a` (accordion trigger) and ensure expand/collapse icons work.
    d.  Ensure responsiveness for all new elements.

### Phase 3: Modify `index.html`

1.  **Insert "Where to Buy" Section:** (Done).
2.  **Add Navigation Link:** (Done).

### Phase 4: Testing & Refinement

1.  **Test `stores.html`:**
    *   Verify top-level index links navigate correctly to groups and standalone stores.
    *   Test accordion functionality: expand/collapse, default state (perhaps collapsed).
    *   Verify all store information and images (from `assets/img/stores/`) display correctly.
    *   Check image uniformity.
    *   Check all links.
    *   Test responsiveness.
2.  **Test `index.html`:** Verify CTA section and nav link.
3.  **Cross-Browser Check.**
4.  **Refine Styles.**

---

## 3. Source Files and Folders for Data Extraction

**Primary Data Files (within `shops/` directory):**

*   **TXT Files (Primary data source for these stores/branches):**
    *   `shops/CaliforniasFinest.txt`
    *   `shops/CannaStock.txt`
    *   `shops/Siam Green Cannabis Co (Nana).txt`
    *   `shops/Siam Green Chinatown.txt`
    *   `shops/Siam Green Koh Samui Cannabis Dispensary.txt`
    *   `shops/Siam Green Phrom Phong, Sukhumvit Dispensary.txt`
    *   `shops/SiamGreen Sala Daeng, Silom Dispensary.txt`
    *   `shops/Slimjim Strains Cannabis & Weed Dispensary.txt`
    *   `shops/Stoned & Co Co. Ltd.txt`
    *   `shops/Strainz Dispensary.txt`
    *   `shops/High Society Cannabis Club Thailand.txt` (Data Extracted)
*   **HTML Files (Data to be extracted, or potentially converted to TXT later):**
    *   `shops/Greenhead Clinic.html` (Data Extracted)
    *   `shops/Cannabis Twins Bangkok.html` (Data Extracted)
    *   `shops/Sawadee Sativa _ Premium Cannabis _ Weed Shop in Bangkok.html` (Data Extracted)
    *   *Note: `shops/Chinatown Cannabis Dispensary, Bangkok.html` was removed by the user and is no longer a source for data extraction.*

**Image Source Folder (Centralized):**

*   `assets/img/stores/`
    *   **Action for Coder:** All relevant images from the original `shops/[StoreName]_files/` directories must be manually moved to this central `assets/img/stores/` folder. Images should be sensibly named (e.g., `ChainName_BranchName_descriptor.jpg` or `StoreName_descriptor.jpg`).

**Stores Previously Noted as "File Not Found" (from `store_data_extraction_progress.md`):**
These remain unprocessed unless new data files are provided for them:
*   Highland Cafe
*   Sukhumweed
*   Four Twenty

*(The coder will need to perform the image consolidation to `assets/img/stores/` and then reference these new paths during Phase 1 data structuring.)*