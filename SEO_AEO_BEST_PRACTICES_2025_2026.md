# SEO & AEO Best Practices for Blog/CMS (2025-2026)

Comprehensive research summary for TanStack Start blog CMS implementation.

---

## 1. Core Web Vitals (2026)

### Current Metrics & Thresholds

| Metric | What it Measures | Good | Needs Improvement | Poor |
|--------|-----------------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | Loading performance | ≤ 2.5s | 2.5–4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | Responsiveness (replaced FID March 2024) | ≤ 200ms | 200–500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | Visual stability | ≤ 0.1 | 0.1–0.25 | > 0.25 |

### Key Changes in 2026
- **INP fully replaced FID** — measures ALL interactions (not just first), making it harder to pass. ~43% of sites now fail INP.
- **Mobile-first weighting** — mobile metrics carry more weight than desktop for rankings.
- **Real User Monitoring (CrUX) matters** — Google uses field data from Chrome users, not lab scores.
- **"Engagement Reliability"** — new concept measuring consistent interactivity throughout the user journey.
- 28-30 days for improvements to reflect in Search Console after fixes.

### Implementation Recommendations for TanStack Start
- **LCP**: Preload hero images/fonts, use AVIF/WebP, inline critical CSS, server-side render above-the-fold content.
- **INP**: Keep all event handlers under 200ms, break up long tasks, minimize JavaScript bundle size, use `requestIdleCallback` for non-critical work.
- **CLS**: Set explicit `width`/`height` on ALL images/videos/iframes, use `font-display: swap`, reserve space for dynamic content (ads, banners).
- **Images**: Use `<img>` with explicit dimensions or CSS `aspect-ratio`. Never use `aspect-ratio` without also setting dimensions.
- **Fonts**: Preload critical fonts with `<link rel="preload">`, use `font-display: swap` or `optional`.

---

## 2. Structured Data (JSON-LD) for Blog CMS

### Schema.org Version: V30.0 (March 2026)

### Required Schema Types for a Blog

#### Blog Schema (on blog index/homepage)
```json
{
  "@context": "https://schema.org",
  "@type": "Blog",
  "@id": "https://example.com/blog#blog",
  "url": "https://example.com/blog",
  "name": "Blog Name",
  "description": "Blog description",
  "publisher": {
    "@type": "Organization",
    "@id": "https://example.com#organization",
    "name": "Organization Name",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png",
      "width": 600,
      "height": 60
    }
  },
  "blogPost": [
    { "@type": "BlogPosting", "@id": "https://example.com/post-1#blogposting" }
  ]
}
```

#### BlogPosting Schema (on each blog post)
```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "@id": "https://example.com/post-url#blogposting",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://example.com/post-url"
  },
  "headline": "Post Title",
  "description": "Post description (155-160 chars)",
  "image": "https://example.com/og-image.jpg",
  "datePublished": "2025-01-15T09:00:00+05:30",
  "dateModified": "2025-06-20T14:30:00+05:30",
  "author": {
    "@type": "Person",
    "@id": "https://example.com/author/john#person",
    "name": "John Doe",
    "url": "https://example.com/author/john",
    "image": "https://example.com/author/john.jpg"
  },
  "publisher": {
    "@type": "Organization",
    "@id": "https://example.com#organization",
    "name": "Organization Name",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  },
  "articleSection": "Technology",
  "wordCount": 1500,
  "speakable": {
    "@type": "SpeakableSpecification",
    "cssSelector": [".article-title", ".article-summary"]
  }
}
```

#### BreadcrumbList Schema (on every page)
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com" },
    { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://example.com/blog" },
    { "@type": "ListItem", "position": 3, "name": "Post Title", "item": "https://example.com/blog/post" }
  ]
}
```

#### FAQPage Schema (for FAQ sections)
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is X?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "X is..."
      }
    }
  ]
}
```

#### HowTo Schema (for tutorials)
```json
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "How to do X",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Step 1",
      "text": "First, do this...",
      "image": "https://example.com/step1.jpg",
      "url": "https://example.com/howto#step1"
    }
  ]
}
```

#### Organization Schema (on homepage)
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://example.com#organization",
  "name": "Organization Name",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "sameAs": [
    "https://twitter.com/example",
    "https://linkedin.com/company/example",
    "https://github.com/example"
  ]
}
```

### Key Properties for BlogPosting
- **Required**: `headline`, `image`, `datePublished`, `author`, `publisher`
- **Highly Recommended**: `dateModified`, `description`, `mainEntityOfPage`, `author.url`, `author.image`
- **Optional but valuable**: `articleSection`, `wordCount`, `speakable`, `backstory`
- Use `@graph` pattern to nest multiple schemas in one `<script>` block

### Schema Best Practices
- Always use most specific type: `BlogPosting` over `Article` for blog posts
- `@id` references allow cross-linking between schemas in `@graph`
- Validate at https://validator.schema.org
- Schema must match visible on-page content
- Google uses ~12 schema types for rich results; BlogPosting is one of them

---

## 3. AEO (Answer Engine Optimization)

### Core Principles
AEO is about making content the source that AI systems (ChatGPT, Perplexity, Google AI Overviews) cite when generating answers. Key shift: optimize for being **cited**, not just **ranked**.

### Content Structure for AEO
1. **Lead with the answer** — Start every post with a 40-60 word self-contained summary that directly answers the primary question
2. **Use question-based H2/H3 headings** — Mirror natural conversational queries ("What is X?", "How do you Y?")
3. **Short paragraphs** — 2-4 sentences max, one idea per paragraph
4. **Lists and tables** — AI-generated answers include lists 78% of the time
5. **Atomic content blocks** — Key information should make sense even when quoted outside full page context
6. **Define key concepts immediately** — Plain-language definitions at the start of sections

### Schema for AEO
- **FAQPage schema** — Mirrors how users ask questions; directly maps to AI extraction patterns
- **HowTo schema** — Step-by-step content is highly extractable
- **Speakable schema** — Marks sections especially suitable for text-to-speech
- **Author schema** — E-E-A-T signals (Experience, Expertise, Authoritativeness, Trustworthiness)
- Schema should be paired with visible on-page content (not hidden)

### Technical AEO Requirements
- **Server-side rendering** — Content must be in raw HTML, not hidden behind JavaScript
- **Clean semantic HTML** — Proper heading hierarchy (H1 > H2 > H3)
- **Fast page loads** — Performance is a trust signal
- **Mobile-friendly** — Responsive design across all breakpoints
- **HTTPS security** — Required for trust

### E-E-A-T Signals for AEO
- Author bios with credentials and expertise
- Publication and modification dates visible
- Links to authoritative external sources
- Original research, data, and insights
- Third-party mentions and citations
- Client testimonials or reviews

### Content Types That Perform Best in AI Search
1. Definition pages ("What is X?")
2. Comparisons ("X vs Y")
3. How-to guides
4. Checklists
5. Glossaries with structured definitions
6. Answer hubs (Q&A-style, 120-180 words each)
7. Original research and data

### llms.txt
Consider implementing `llms.txt` at your site root — a new convention that guides AI crawlers to your most important content. Format:
```
# Site Name

> Brief description

## Sections
- [Blog](https://example.com/blog): Latest articles
- [About](https://example.com/about): Company info
```

---

## 4. Sitemap Best Practices

### Required Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/blog/post-1</loc>
    <lastmod>2025-06-15</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
    <image:image>
      <image:loc>https://example.com/images/post-1-hero.jpg</image:loc>
      <image:title>Post Title Image</image:title>
      <image:caption>Descriptive caption</image:caption>
    </image:image>
  </url>
</urlset>
```

### Key Rules
- **Max 50,000 URLs** per sitemap file
- **Max 50MB** uncompressed per file
- **Only canonical, indexable URLs** — exclude noindexed, redirects, 4xx/5xx, duplicate, search pages, admin pages
- **UTF-8 encoding** required
- **`lastmod` must be accurate** — Google ignores auto-generated/inaccurate dates. Only update for meaningful content changes
- **`priority` and `changefreq` are ignored by Google** — include for protocol compliance but don't expect behavior changes
- Use **sitemap index file** (`sitemap_index.xml`) when splitting across multiple sitemaps

### Image Sitemap
```xml
<url>
  <loc>https://example.com/page</loc>
  <image:image>
    <image:loc>https://example.com/image.jpg</image:loc>
    <image:title>Image Title</image:title>
    <image:caption>Descriptive caption (max 2000 chars)</image:caption>
  </image:image>
</url>
```
- Max 50,000 images per sitemap
- Include only relevant, high-quality images
- Use absolute URLs

### Video Sitemap
- Use `video:video` namespace
- Required: `video:thumbnail_loc`, `video:title`, `video:description`
- Optional: `video:content_loc`, `video:duration`, `video:expiration_date`

### News Sitemap
- Only articles published within last 48 hours
- Required: `news:publication`, `news:publication_date`, `news:title`
- Must be part of a Google News-approved site

### RSS/Atom Feed as Sitemap
- Google accepts RSS 2.0, Atom 1.0 as sitemap alternatives
- RSS/Atom feeds are easier to maintain for CMSs
- Can include video info via mRSS (Media RSS)
- Reference in robots.txt: `Sitemap: https://example.com/sitemap.xml`

### TanStack Start Implementation
- Generate sitemap dynamically at build time or on-demand
- Use sitemap index file with separate sitemaps for `/blog`, `/pages`, `/images`
- Update `lastmod` only when content changes (not on every build)
- Include `<loc>` as absolute URLs
- Reference sitemap in `robots.txt`

---

## 5. Meta Tag Best Practices

### Title Tag
- **Length**: 50-60 characters (Google truncates at ~600px / 58-62 chars)
- **Format**: Primary Keyword + Brand (e.g., "React Performance Tips | MyBlog")
- **Unique** for every page
- Google rewrites titles ~61.6% of the time — write compelling originals
- Front-load important keywords

### Meta Description
- **Length**: 150-160 characters (Google shows ~155-160 on desktop, ~120 on mobile)
- **Unique** for every page
- Include target keyword naturally
- Write as a pitch — this is your ad copy in SERPs
- AI search engines (ChatGPT, Perplexity) also use meta descriptions for source selection

### Open Graph Tags
```html
<meta property="og:type" content="article" />
<meta property="og:title" content="Post Title" />
<meta property="og:description" content="Post description" />
<meta property="og:image" content="https://example.com/og-image.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:alt" content="Descriptive alt text" />
<meta property="og:url" content="https://example.com/post-url" />
<meta property="og:site_name" content="Site Name" />
<meta property="article:published_time" content="2025-01-15T09:00:00Z" />
<meta property="article:modified_time" content="2025-06-20T14:30:00Z" />
<meta property="article:author" content="Author Name" />
<meta property="article:section" content="Technology" />
<meta property="article:tag" content="React" />
<meta property="article:tag" content="Performance" />
```

### OG Image Specifications
- **Dimensions**: 1200 × 630 px (1.91:1 ratio)
- **Safe zone**: Center 1100 × 580 px (platforms crop edges)
- **Format**: JPEG for photos, PNG for graphics with text
- **File size**: Under 1MB (WhatsApp drops images >300KB)
- Always include `og:image:width` and `og:image:height` — fixes first-scrape blank preview bug
- Design for readability at 400px width (thumbnail size on mobile)

### Twitter Card Tags
```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Post Title" />
<meta name="twitter:description" content="Post description" />
<meta name="twitter:image" content="https://example.com/og-image.jpg" />
<meta name="twitter:image:alt" content="Alt text for image" />
<meta name="twitter:site" content="@brandhandle" />
<meta name="twitter:creator" content="@authorhandle" />
```

### Twitter Card Types
| Type | Use For | Image Size |
|------|---------|------------|
| `summary_large_image` | Blog posts, landing pages | 1200×630 px |
| `summary` | Utility pages, no hero image | 240×240 px min |
| `app` | App install pages | — |
| `player` | Audio/video content | — |

**Always use `summary_large_image`** for blog posts — dominates the feed, higher CTR.

### Additional Meta Tags
```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://example.com/canonical-url" />
<meta name="theme-color" content="#ffffff" />
```

---

## 6. robots.txt for Modern Crawlers

### AI Crawler Categories (2026)

**Search-facing (allow for visibility)**:
| Bot | Operator | Purpose |
|-----|----------|---------|
| GPTBot | OpenAI | ChatGPT search answers + training |
| ChatGPT-User | OpenAI | Real-time browsing |
| ClaudeBot | Anthropic | Claude web search + training |
| PerplexityBot | Perplexity | Powers Perplexity search results |
| Googlebot | Google | Standard search + AI Overviews |
| Amazonbot | Amazon | Alexa answers + Amazon search |
| Applebot-Extended | Apple | Apple Intelligence + Siri |

**Training-only (consider blocking)**:
| Bot | Operator | Purpose |
|-----|----------|---------|
| Bytespider | ByteDance | Training data (crawls aggressively) |
| CCBot | Common Crawl | Open web archiving for LLM training |
| cohere-ai | Cohere | Training data |
| Meta-ExternalAgent | Meta | Meta AI training |
| Google-Extended | Google | Gemini model training |

### Recommended robots.txt for Blog CMS
```
# Allow search-facing AI bots (these cite content and send traffic)
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

# Allow standard search (also powers AI Overviews)
User-agent: Googlebot
Allow: /

User-agent: Amazonbot
Allow: /

# Block training-only crawlers
User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: cohere-ai
Disallow: /

User-agent: Meta-ExternalAgent
Disallow: /

# Optional: block Gemini training while keeping search indexing
User-agent: Google-Extended
Disallow: /

# Default rules
User-agent: *
Disallow: /api/
Disallow: /admin/
Disallow: /search
Disallow: /*?utm_
Allow: /

Sitemap: https://example.com/sitemap.xml
```

### Key Notes
- robots.txt is advisory, not enforcement — well-behaved bots honor it, scrapers may not
- Changes take 24-72 hours to take effect across major crawlers
- Cloudflare's "Bot Fight Mode" can silently block AI crawlers — check your CDN settings
- Block internal search pages, admin areas, API endpoints
- Never block `/api/` JSON endpoints from Googlebot if they contain structured data
- Review quarterly — new crawlers appear regularly

---

## 7. RSS Feed Best Practices

### Format Choice: RSS 2.0 vs Atom 1.0

| Feature | RSS 2.0 | Atom 1.0 |
|---------|---------|----------|
| Namespace support | Limited (via extensions) | Built-in |
| Character encoding | Varies | UTF-8 only |
| Uniqueness constraints | Loose | Strict |
| Self-link | `<atom:link rel="self">` | `<link rel="self">` |
| W3C validation | No | Yes |
| Recommendation | Most widely supported | More technically correct |

**For a blog CMS**: Use **RSS 2.0** with `<atom:link>` self-reference for maximum compatibility. Most readers, aggregators, and services (Feedly, IFTTT, etc.) support both.

### RSS 2.0 Template
```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Blog Name</title>
    <link>https://example.com</link>
    <description>Blog description</description>
    <language>en-us</language>
    <lastBuildDate>RFC822 date</lastBuildDate>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml" />
    <item>
      <title>Post Title</title>
      <link>https://example.com/blog/post</link>
      <guid isPermaLink="true">https://example.com/blog/post</guid>
      <pubDate>RFC822 date</pubDate>
      <dc:creator>Author Name</dc:creator>
      <description>Summary or first 300 chars</description>
      <content:encoded><![CDATA[Full HTML content]]></content:encoded>
      <category>Category Name</category>
    </item>
  </channel>
</rss>
```

### Best Practices
- **Include full HTML content** in `<content:encoded>` — many readers prefer full-text
- **Include `<atom:link rel="self">`** for feed validators
- **Use `<guid isPermaLink="true">`** with the post URL
- **RFC822 date format**: `Mon, 15 Jan 2025 09:00:00 +0000`
- **Limit to 10-20 items** in the feed for performance
- **Include `<lastBuildDate>`** at channel level
- **Reference feed in HTML**: `<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />`
- **Place at standard URL**: `/feed.xml`, `/rss.xml`, or `/feed`
- RSS feeds are NOT a sitemap replacement — maintain both
- RSS feeds can be submitted to Google Search Console as a sitemap alternative

---

## 8. Blog Tags & Categories SEO

### Category Pages
- **Index category pages** if they have unique content and target valuable keywords
- Add **unique descriptions** (300-500 words) at the top of each category page
- Use **unique title tags and meta descriptions** per category
- Each category should have **10+ posts** minimum
- Consolidate overlapping categories (e.g., "SEO" and "Search Engine Optimization")
- Limit to **10-20 categories** for most blogs

### Tag Pages
- **Noindex tag pages** by default unless they serve a clear user purpose
- Tags create thin content risk — most tag pages have 1-3 posts with no unique content
- If tags are valuable, enrich them with unique descriptions and target long-tail keywords
- Use `rel="nofollow"` on tag links if not noindexing
- Avoid creating tags that overlap with categories

### Canonical Handling
- Category/tag pages should have self-referencing canonicals
- If paginated, each page gets its own canonical (e.g., `/category/tech/page/2/`)
- Use `rel="next"` and `rel="prev"` for pagination
- Never canonical tag pages to the homepage

### Implementation for TanStack Start
```html
<!-- Category page with unique content -->
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://example.com/category/technology" />
<title>Technology Articles | Blog Name</title>
<meta name="description" content="Explore our latest technology articles..." />

<!-- Tag page (noindex by default) -->
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="https://example.com/tag/react" />
```

### URL Structure
- Categories: `/category/technology/` or `/blog/technology/`
- Tags: `/tag/react/` or `/tags/react/`
- Keep slugs lowercase, hyphenated, and descriptive

---

## 9. Internal Linking Best Practices

### Core Principles (2026)
1. **No strict link limit** — Google says links should be "reasonable and useful"
2. **Descriptive anchor text** — use keywords that describe the destination page
3. **Every page must be reachable** within 3 clicks from homepage
4. **No orphan pages** — every page needs at least 1 internal link
5. **Bidirectional linking** — pages should link to each other when relevant

### Topic Cluster / Pillar Page Model
```
[Pillar Page: "React Performance Guide"] (3,000-5,000 words)
  ├── [Cluster: "React Memo Optimization"]
  ├── [Cluster: "useCallback Best Practices"]  
  ├── [Cluster: "Virtual DOM Performance"]
  ├── [Cluster: "Code Splitting in React"]
  └── [Cluster: "React Profiler Guide"]
```

- Pillar page provides comprehensive overview, links to all cluster pages
- Each cluster page links back to pillar with keyword-rich anchor text
- Cluster pages link to related cluster pages laterally
- Builds topical authority — sites with 20 interlinked articles outrank those with 1 isolated 5,000-word guide

### Implementation Rules
- **Anchor text**: "Learn more about React performance" (not "click here")
- **Context links**: Link naturally within body content, not just navigation
- **Related posts**: Show 3-5 related articles at bottom of each post
- **Breadcrumbs**: Implement for both UX and SEO (with BreadcrumbList schema)
- **Hub pages**: Create category/topic hub pages that link to all posts in that area
- **Audit regularly**: Use tools to find broken links and orphan pages

### PageRank Flow
- Internal links distribute PageRank from high-authority pages to newer/lower-authority pages
- Link from high-traffic pages to high-priority pages you want to rank
- Homepage has most authority — use navigation to distribute it to key pages
- Avoid excessive footer/sidebar links that dilute link equity

---

## 10. Schema.org Latest Changes & Recommendations

### Schema.org V30.0 (March 2026)
- Over 800 types available; Google uses ~12 for rich results
- 45+ million domains use Schema.org markup
- 450+ billion Schema.org objects indexed by Google

### Blog-Specific Schema Updates
- **`blogPost` property** supersedes `blogPosts` (singular vs plural)
- **`speakable`** property on BlogPosting — marks sections for text-to-speech (AEO)
- **`backstory`** property — explains how/why an article was created (E-E-A-T)
- **`sharedContent`** on SocialMediaPosting — for shared media within posts
- **`articleSection`** — categorize posts within the blog

### Key Schema Types for Blogs (Priority Order)
1. **BlogPosting** — every blog post (use most specific type)
2. **Blog** — blog index/homepage
3. **BreadcrumbList** — every page
4. **Organization** — homepage
5. **Person** — author pages
6. **FAQPage** — posts with FAQ sections
7. **HowTo** — tutorial/how-to posts
8. **WebPage** — fallback for non-blog pages
9. **WebSite** — homepage with SearchAction for sitelinks search box

### @graph Pattern (Recommended)
Use `@graph` to combine multiple schemas in one script block:
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BlogPosting", ... },
    { "@type": "BreadcrumbList", ... },
    { "@type": "Person", ... }
  ]
}
```

### Validation
- Google Rich Results Test: https://search.google.com/test/rich-results
- Schema.org Validator: https://validator.schema.org
- Check Google Search Console for structured data errors

### Critical Rules
- Schema must match visible on-page content
- Use `@id` references for cross-linking within `@graph`
- Don't use schema for content that isn't on the page
- Keep structured data aligned with visible content for E-E-A-T
- Use ISO 8601 date format for all date properties

---

## Summary: TanStack Start Blog CMS Checklist

### Must-Have (Day 1)
- [ ] JSON-LD structured data: Blog, BlogPosting, BreadcrumbList, Organization
- [ ] Meta tags: title, description, canonical, robots, viewport, charset
- [ ] Open Graph tags with 1200×630 images and width/height
- [ ] Twitter Card tags with `summary_large_image`
- [ ] XML sitemap with accurate `lastmod` dates
- [ ] robots.txt with AI crawler rules
- [ ] RSS feed at `/feed.xml`
- [ ] Semantic HTML with proper heading hierarchy
- [ ] Core Web Vitals: explicit image dimensions, font-display swap, preloaded critical resources

### Should-Have (First Month)
- [ ] FAQPage schema for FAQ sections
- [ ] HowTo schema for tutorials
- [ ] Speakable schema for key content sections
- [ ] Category pages with unique content (indexed)
- [ ] Tag pages noindexed by default
- [ ] Internal linking: related posts, breadcrumbs, topic clusters
- [ ] Image sitemap for important images
- [ ] Author pages with Person schema
- [ ] llms.txt at site root

### Nice-to-Have (Ongoing)
- [ ] News sitemap (if publishing frequently)
- [ ] Video sitemap (if using video content)
- [ ] Content freshness monitoring (update dates, stats)
- [ ] AEO tracking (AI citation monitoring)
- [ ] Topic cluster architecture with pillar pages
- [ ] Regular structured data audits via Search Console
