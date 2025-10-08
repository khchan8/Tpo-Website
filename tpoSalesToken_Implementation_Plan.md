# TPO Sales Token Implementation Plan

## Overview
Create a new `tpoSalesToken` that provides the most limited access - only showing Sales Tools in the Employee Portal dropdown and preventing access to all other employee pages (Performance, ERP, CRM, Customer Portal).

## Current System Analysis
- **Authentication System**: Token-based using localStorage and Google Apps Script
- **Current Tokens**: tpoEmployeeToken, tpoCRMToken, tpoCRMManagerToken, tpoFuzziesToken, tpoTysonToken
- **Pages with Employee Portal**: index.html, Sales-James.html, erp.html, performance.html, CRMv4.html, CRMv4-M.html, oem-edibles-manufacturing.html, oem-preroll-production.html, stores.html
- **Employee Portal Structure**: Contains Sales Tools, Performance, ERP, CRM, and Customer Portal sections

## Implementation Strategy

### 1. Token Hierarchy (Most to Least Privileged)
1. **Current tokens** (tpoEmployeeToken, etc.) - Full access to all sections
2. **tpoSalesToken** - Access ONLY to Sales Tools section

### 2. Core Changes Required

#### A. Authentication Logic Enhancement
Create a unified function to determine menu visibility based on tokens:
- If user has `tpoSalesToken` ONLY → Show only Sales Tools
- If user has any other tokens → Show all sections (current behavior)
- If user has `tpoSalesToken` + other tokens → Show all sections (other tokens take precedence)

#### B. Menu Structure Modification
Add CSS classes to menu items for selective hiding:
- `.menu-sales-tools` - Sales Tools section (always visible for logged-in users)
- `.menu-performance` - Performance link
- `.menu-erp` - ERP link  
- `.menu-crm` - CRM link
- `.menu-customer-portal` - Customer Portal section

#### C. Page Access Control
Enhance page-level authentication to check tokens:
- Sales Tools pages: Allow access with any token including tpoSalesToken
- Performance/ERP/CRM/Customer pages: Block access if user ONLY has tpoSalesToken

### 3. Detailed Implementation Steps

#### Step 1: Create Enhanced Authentication Function
```javascript
function checkAuthorizationWithSalesToken(grantedTokens, userEmail) {
    // Check if user has only tpoSalesToken
    const hasOnlySalesToken = grantedTokens.length === 1 && grantedTokens.includes('tpoSalesToken');
    
    // Update UI based on token hierarchy
    if (hasOnlySalesToken) {
        // Show only Sales Tools
        hideNonSalesMenuItems();
    } else if (grantedTokens.length > 0) {
        // Show all menu items for other tokens
        showAllMenuItems();
    }
}
```

#### Step 2: Update HTML Structure
Add CSS classes to all Employee Portal dropdown menu items across all pages:
- Sales Tools section: `class="menu-sales-tools"`
- Performance link: `class="menu-performance"`
- ERP link: `class="menu-erp"`
- CRM link: `class="menu-crm"`
- Customer Portal section: `class="menu-customer-portal"`

#### Step 3: Update Page Access Control
Modify authentication checks on restricted pages:
- **Sales-James.html**: Allow access with tpoSalesToken but hide non-sales menu items
- **performance.html, erp.html, CRMv4.html, etc.**: Block access if user only has tpoSalesToken
- **Sales Tools pages** (AA-Sales-Tools.html, etc.): Allow access with any token

#### Step 4: CSS for Menu Visibility
Add CSS classes to control visibility:
```css
.menu-sales-tools { display: block !important; }
.menu-performance, .menu-erp, .menu-crm, .menu-customer-portal { 
    transition: display 0.3s ease;
}

/* Hide non-sales items for sales-only users */
body.sales-only-user .menu-performance,
body.sales-only-user .menu-erp,
body.sales-only-user .menu-crm,
body.sales-only-user .menu-customer-portal {
    display: none !important;
}
```

### 4. Files to Modify

#### Must Modify:
1. **index.html** - Main navigation with Employee Portal
2. **Sales-James.html** - Sales page with limited access
3. **performance.html** - Block sales-only users
4. **erp.html** - Block sales-only users
5. **CRMv4.html** - Block sales-only users
6. **CRMv4-M.html** - Block sales-only users

#### Should Modify:
7. **oem-edibles-manufacturing.html** - Consistent Employee Portal
8. **oem-preroll-production.html** - Consistent Employee Portal
9. **stores.html** - Consistent Employee Portal

#### No Changes Needed:
- **Tyson-data.html, Fuzzies-data.html** - No Employee Portal dropdown

### 5. Google Sheet Integration
No changes needed to the Google Apps Script - the token system already supports multiple tokens per user. Just need to add users with `tpoSalesToken` in the Type column.

### 6. Testing Strategy
1. **Sales-only user test**: Login with tpoSalesToken only
   - Verify only Sales Tools visible in dropdown
   - Verify blocked from performance.html, erp.html, CRMv4.html
   - Verify can access Sales Tools pages

2. **Mixed token user test**: Login with tpoSalesToken + other tokens
   - Verify all menu items visible (other tokens take precedence)

3. **Regular employee test**: Login with existing tokens
   - Verify no change in current behavior

### 7. Security Considerations
- Users with tpoSalesToken cannot access restricted pages even with direct URLs
- Page-level authentication prevents bypassing menu restrictions
- Token hierarchy ensures backwards compatibility

### 8. Implementation Priority
1. High Priority: index.html, Sales-James.html, performance.html, erp.html, CRMv4.html
2. Medium Priority: CRMv4-M.html, oem pages, stores.html
3. Low Priority: Documentation updates

## Expected Outcome
- Sales users with tpoSalesToken see only Sales Tools in Employee Portal
- Sales users cannot access Performance, ERP, CRM, or Customer Portal pages
- Existing users with other tokens see no change in functionality
- System maintains backwards compatibility
- Simple token-based access control without complex security overhead