# Filtering and Noise reduction

Below is the **exact grouping + filtering strategy** you should apply to turn your raw trace into a _clean, meaningful_ Mermaid flow.  
Your uploaded trace confirms you are seeing **exactly the expected noise**: fonts, images, Next.js chunks, tracking pixels, script tags, ads, queue-it, analytics, etc.

trace (1)

To make the flow readable, you need **three layers of filters**:

----------

## 1. **FILTER OUT NOISE**

Noise = requests that **do not represent business interactions**.

Based on your trace, you should _ignore_ automatically:

### **A. Static assets**

Pattern match:

`/\.(png|jpg|jpeg|gif|svg|webp|ico)$/  
/\.(css|woff|woff2|ttf)$/  
/_next\/static/  
/assets-event-page\.svc\.sympla\.com\.br\/evento\/_next/` 

Static assets do not reflect meaningful backend activity.

----------

### **B. Third-party tracking / ads / analytics**

Ignore requests to domains such as:

-   `google-analytics.com`
    
-   `googletagmanager.com`
    
-   `g.doubleclick.net`
    
-   `pagead2.googlesyndication.com`
    
-   `facebook.net`
    
-   `clarity.ms`
    
-   `bat.bing.com`
    
-   `tiktok.com`
    
-   `cookielaw.org`
    
-   `intercom.io`
    
-   `hs-scripts.com` (Hubspot)
    
-   `topsort` CDN loads
    
-   `cdn.cookielaw.org`
    
-   `fonts.googleapis.com` / `fonts.gstatic.com`
    

These generate dozens of events and pollute the diagram.

----------

### **C. Chrome extension own requests**

(from your extension loading itself)

Ignore:

`chrome-extension://*` 

----------

### **D. CORS preflight requests**

Any OPTIONS request:

`method === 'OPTIONS'` 

These add no semantic value.

----------

### **E. Status 304**

Cache hits do not indicate real backend activity.

----------

### **Summary rule:**

`if ( isStaticAsset(url) || isThirdParty(url) ||
  method === "OPTIONS" ||
  status === 304 || isExtension(url)
) { ignore();
}` 

After this first pass, your trace reduces from ~350 events → ~15–20 meaningful ones.

----------

## 2. **GROUP BY SERVICE / DOMAIN**

Your diagram shouldn’t show individual URLs.  
It should show **services**.

### Example grouping rules:

Domain pattern

Group name

`event-page.svc.sympla.com.br/api/event-bff/*`

`event-bff`

`growthbook-cache.svc.sympla.com.br/api/*`

`growthbook-cache`

`sympla.com.br/evento/*`

`web-app`

`sympla.queue-it.net/*`

`queue-it`

`images.sympla.com.br/*`

ignore (static)

`assets-event-page.svc.sympla.com.br/_next/*`

ignore

All third-party

ignore

**How to derive group name:**

1.  Extract domain.
    
2.  Remove prefixes like `www.`.
    
3.  Normalize:
    
    -   if contains `.svc.sympla.com.br`, extract service name before `.svc.`
        
    -   if is sympla.com.br but not API = `web-app`.
        

Example:

`https://event-page.svc.sympla.com.br/api/event-bff/purchase/event/3154071 → domain: event-page.svc.sympla.com.br
→ service: event-page
→ type: BFF` 

For Mermaid:

`WEB → EVENT-BFF: GET /purchase/event/:id` 

----------

## 3. **GROUP BY "USER-INTENT BLOCKS"**

### This is the biggest improvement.

Your trace is huge because you're capturing:

-   page load
    
-   hydration
    
-   Next.js chunk loading
    
-   fonts & images
    
-   AB tests
    
-   recommendation widgets
    
-   ads
    
-   BFF dependencies
    
-   preloads & preconnects
    

But you only want:

`(click) → (main page load) → (main backend calls triggered by page logic)` 

### Algorithm:

When a click occurs:

`- mark the click as the start  of a new "block"
- capture only the first-level calls that happen within X ms` 

**X = 500–1500 ms**, depending on your preference.

For example, after a click the system might call:

-   main HTML (200)
    
-   BFF endpoints (tickets, recommendations)
    
-   GrowthBook (feature flags)
    

This yields a small group.

### Example grouping output:

#### Block 1: User clicked image

`CLICK → Navigate: /evento/:slug
    → event-bff GET /purchase/event/:id
    → event-bff GET /organizer/:id
    → growthbook-cache GET /event-page` 

Everything unrelated is ignored.

----------

## 4. **NORMALIZE URL PATHS**

Instead of showing full URLs like:

`https://event-page.svc.sympla.com.br/api/event-bff/recommendation?eventId=3154071&type=event-page-footer&category=event&events_ids=...` 

Show:

`GET  event-bff /recommendation` 

**Rule:**

-   Remove full query params
    
-   Collapse route params to `:id`
    

`/purchase/event/3154071/tickets  →  /purchase/event/:id/tickets` 

----------

## 5. **DE-DUPLICATE**

Page loads often call:

-   the same request twice (Next.js retry)
    
-   preconnect + prefetch + actual fetch
    
-   multiple analytics hits
    

You should:

`Keep only the first occurrence per (method  + normalized path + domain) inside a block.` 

----------

## Final Result: A Clean Flow

Your current flow is huge because it includes **~350 events**. After applying the filters, you’ll end up with **5–10 meaningful interactions**.

### Example simplified Mermaid:

`sequenceDiagram
    autonumber
    participant USER
    participant WEB as Web App
    participant BFF as Event-BFF
    participant GB as Growthbook

    USER ->> WEB: click img.pn67h17
    WEB ->> WEB: Navigate /evento/:id
    WEB ->> BFF: GET /purchase/event/:id/tickets
    WEB ->> BFF: GET /organizer/:id
    WEB ->> GB: GET /event-page (feature flags)` 

This is **1000× cleaner** than your current output.

----------

## Recommended Implementation Order

1.  **Noise filter (mandatory)**
    
2.  **Group by domain → service**
    
3.  **Block events after user actions**
    
4.  **URL normalization**
    
5.  **Deduplication**
    
6.  **Mermaid generation**