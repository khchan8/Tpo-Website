# PRD v1.6: Cloudflare Zero Trust Access for Monthly Report

## 1. Objective
Implement robust, server-level access control for the static `MonthlyReport` site hosted on GitHub Pages. Since the site is fully static and relies on client-side API keys, client-side JavaScript passwords are insufficient. We will leverage Cloudflare Zero Trust (Access) to put a secure identity-aware proxy in front of the site, ensuring only specifically authorized individuals can load the page.

## 2. Requirements
- **Hosting:** GitHub Pages
- **DNS/Routing:** Cloudflare (Domain must be proxied through Cloudflare)
- **Authentication Method:** Google Account SSO and/or One-Time Email PIN.
- **Access Control:** The system **must** allow the administrator to specify exactly which email addresses (e.g., `client@gmail.com`, `ceo@company.com`) are permitted to view the site.
- **Cost:** Must utilize Cloudflare's free tier (up to 50 users free).

## 3. Answer to "Can I specify which Gmail they are using?"
**Yes, absolutely.** Cloudflare Access allows you to create explicit "Include" rules based on email addresses. If you list `clientA@gmail.com` and `partnerB@gmail.com` in your policy, *only* those two Google accounts will be let through. If someone else tries to log in with `random.person@gmail.com`, Cloudflare will reject them before they ever see your website.

---

## 4. Step-by-Step Implementation Guide (For the Administrator)

These steps are performed entirely in the [Cloudflare Dashboard](https://dash.cloudflare.com/), as this configuration happens at the network edge, not in the codebase.

### Step 1: Verify Cloudflare Proxy is Active
Since your domain is already managed by Cloudflare and hosted on GitHub:
1. Log in to your Cloudflare Dashboard and select your domain.
2. Go to **DNS** -> **Records**.
3. Look for the `CNAME` or `A` record pointing to GitHub Pages for your domain (e.g., `report.yourdomain.com`).
4. Ensure the **Proxy status** toggle is set to **Proxied (Orange Cloud)**. If it is "DNS Only (Grey Cloud)", Cloudflare Access cannot protect it.

### Step 2: Initialize Cloudflare Zero Trust
1. In the left-hand sidebar of the Cloudflare Dashboard, click on **Zero Trust**. (If it's your first time, you may need to choose a team name and select the Free plan, which requires a payment method on file but charges $0).
2. Once in the Zero Trust dashboard, go to **Settings** -> **Authentication**.
3. Under **Login methods**, "One-Time PIN" is enabled by default (this sends a code to their email). 
4. *(Optional but recommended)* Click **Add new** and select **Google** to allow them to click "Login with Google" instead of typing a PIN.

### Step 3: Create the Access Application
1. In the Zero Trust left sidebar, navigate to **Access** -> **Applications**.
2. Click **Add an application**.
3. Select **Self-hosted**.
4. **Application name:** `TPO Monthly Report` (This is what users will see on the login screen).
5. **Session Duration:** Set to 24 hours or 1 week (how often they need to re-authenticate).
6. **Application domain:** Enter the exact domain/subdomain where your GitHub Pages site is hosted (e.g., `report.yourdomain.com`).
7. Click **Next**.

### Step 4: Define the Access Policy (The "Allowed Gmails" list)
This is where you specify exactly who gets in.
1. **Policy Name:** `Allowed Clients`
2. **Action:** `Allow`
3. Scroll down to the **Create additional rules** section.
4. Under **Include**, set the selector to **Emails**.
5. In the value box, type out the exact email addresses you want to allow (e.g., `john.doe@gmail.com`, `jane.smith@company.com`). You can also use **Emails ending in** to allow an entire company domain like `@tpowellness.com`.
6. Click **Next**.

### Step 5: Finalize and Test
1. Review your settings and click **Add application**.
2. Open a new "Incognito" or "Private" browsing window.
3. Navigate to your site URL. 
4. You should be intercepted by a Cloudflare login screen.
5. Attempt to log in with an unauthorized email — it should block you.
6. Attempt to log in with an authorized email — it should let you through to the `index.html`.

---

## 5. Security Notes for this Setup
* **GitHub Repository Visibility:** Because your site is on GitHub Pages, the underlying repository **must be set to Private**. If the repository is public, anyone can go to `github.com/your-username/Tpo-Website` and read the code and API keys, bypassing Cloudflare completely.
* **Direct IP Access:** Since GitHub Pages doesn't allow you to block direct traffic to their servers, there is a tiny technical loophole where someone who knows GitHub's underlying IP architecture could try to bypass Cloudflare. For a static dashboard, this is generally considered an acceptable risk, but the only way to be 100% airtight is to use Cloudflare Pages or a VPS instead of GitHub Pages.
