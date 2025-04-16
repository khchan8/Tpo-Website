# Login Page Redirection Plan (Mobile vs. Desktop)

## 1. Goal

Implement logic to redirect users to the appropriate login page based on their device type:
- Mobile users should be directed to `tpologin-m.html`.
- Desktop users should be directed to `tpologin.html`.

This applies to:
- Links clicked on `index.html`.
- Automatic redirects triggered by other pages (e.g., `erp.html`, `CRMv4.html`, `CRMv4-M.html`, `performance.html`, `Fuzzies.html`) when a session is invalid or missing.

## 2. Implementation Strategy

### 2.1. Device Detection Function
A simple JavaScript function will be created to detect mobile devices based on the `navigator.userAgent` string. This function will be included in all relevant HTML files.

```javascript
function isMobileDevice() {
  // Basic check for common mobile user agent strings
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
```

### 2.2. Modify `index.html`
- Add the `isMobileDevice` function within a `<script>` tag.
- Add another script block (or extend the existing one) to run on `DOMContentLoaded`.
- This script will:
    - Call `isMobileDevice()`.
    - If it returns `true`, find all `<a>` tags whose `href` attribute ends with `tpologin.html`.
    - For each matching link, update its `href` attribute to `tpologin-m.html`.

### 2.3. Modify Other Pages (`erp.html`, `CRMv4.html`, `CRMv4-M.html`, `performance.html`, `Fuzzies.html`)
- Add the `isMobileDevice` function within a `<script>` tag in each file.
- Locate the JavaScript code where the `loginPage` variable is defined (likely near the top of the main script or within the `redirectToLogin` function).
- Change the definition from a static string to a conditional assignment:
    ```javascript
    // Replace: const loginPage = 'tpologin.html';
    // With:
    const loginPage = isMobileDevice() ? 'tpologin-m.html' : 'tpologin.html';
    ```
- Ensure the `redirectToLogin` function uses this `loginPage` variable when constructing the redirect URL.

## 3. Files to Modify

- `index.html`
- `erp.html`
- `CRMv4.html`
- `CRMv4-M.html`
- `performance.html`
- `Fuzzies.html`

## 4. Expected Outcome

Users will be seamlessly directed to the correct login page (`tpologin.html` for desktop, `tpologin-m.html` for mobile) whether clicking a link on the homepage or being redirected due to an invalid session from other application pages.