# EigenSwarm Frontend — Design Uplift Plan
## Inspired by yield.xyz aesthetic, adapted for EigenSwarm identity

---

## 1. Current State vs Target Aesthetic

### What we have now
- Light-mode only (`#F5F3EE` warm cream background)
- Flat card system (`bg-white`, `border-subtle`, `shadow-card`)
- Serif display font (Instrument Serif) + sans body (DM Sans) + mono (JetBrains)
- Violet/purple brand color (`#7B3FE4`)
- Subtle dot-grid hero background with floating particles
- IntersectionObserver `Reveal` fade-up animations
- `card-lift` hover (translateY -4px)
- Marquee logo carousel

### What yield.xyz does differently (and what we want to adopt)
- **Dark-dominant layout** with high-contrast white cards floating on near-black (`#131517`)
- **Rounded section transitions** — white sections curve into dark with `border-radius: 60px 60px 0 0`
- **Generous border-radius** on cards (30px) and buttons (40-48px)
- **Parallax on decorative elements** via Locomotive Scroll (`data-speed` attributes)
- **Warm accent gradient** (orange-pink-gold) alongside brand color
- **Background light glows** — radial blurs in pink/amber/purple behind content
- **Video content** embedded in cards for product demos
- **Bento grid layout** — alternating card sizes in a 2x2 feature grid
- **0.5s cubic-bezier(0.4, 0, 0.2, 1)** transition timing on all interactive elements
- **Typography contrast** — serif at 70-90px for section titles, tight -2px letter-spacing

---

## 2. Design Tokens to Add/Modify

### 2.1 Color palette expansion (tailwind.config.ts)

```
colors: {
  bg: {
    void:     '#0D0E10',       // NEW: primary dark background (was #F5F3EE)
    deep:     '#131517',       // NEW: secondary dark surface
    alt:      '#1A1C1F',       // UPDATED: dark alt (was #EDEBE5)
    card:     '#FFFFFF',       // KEEP: white cards for contrast
    elevated: '#F9F8F5',       // KEEP: light elevated surfaces
    hover:    '#F3F1EC',       // UPDATED: hover on light cards
    'card-dark': '#1E2023',    // NEW: dark card variant
  },
  eigen: {
    violet:       '#7B3FE4',   // KEEP: primary brand
    'violet-deep':'#5B21B6',   // KEEP
    'violet-light':'#A78BFA',  // KEEP
    'violet-wash': '#EDE9FE',  // KEEP
  },
  accent: {
    flame:   '#FF632F',        // NEW: warm orange (from yield gradient)
    rose:    '#FF5E8D',        // NEW: warm pink
    gold:    '#FFCE86',        // NEW: warm gold
  },
  txt: {
    primary:   '#1A1A2E',      // KEEP: on light surfaces
    secondary: '#55546B',      // KEEP
    muted:     '#706F84',      // KEEP
    disabled:  '#B8B7C8',      // KEEP
    'on-dark':   '#FFFFFF',    // NEW: white text on dark bg
    'on-dark-muted': '#878285',// NEW: muted on dark bg
    'on-dark-subtle':'#505659',// NEW: subtle on dark bg
  },
}
```

### 2.2 Border radius scale

```
borderRadius: {
  'sm':   '8px',
  'md':   '12px',
  'lg':   '20px',
  'xl':   '30px',      // NEW: yield-style cards
  '2xl':  '40px',      // NEW: pill buttons
  '3xl':  '48px',      // NEW: primary CTA buttons
  'section': '60px',   // NEW: section curve transitions
}
```

### 2.3 Box shadows expansion

```
boxShadow: {
  'card':       '0 1px 3px rgba(0,0,0,0.06)',
  'card-hover': '0 8px 24px rgba(0,0,0,0.08)',
  'card-float': '0 8px 35px rgba(0,0,0,0.36)',  // NEW: floating on dark bg
  'btn-glow':   '0 2px 12px rgba(123,63,228,0.25)', // existing gradient btn
  'btn-glow-hover': '0 6px 24px rgba(123,63,228,0.35)',
}
```

### 2.4 Animation / transition timing

```
transitionTimingFunction: {
  'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',  // yield.xyz standard
}
transitionDuration: {
  'smooth': '500ms',
}
```

### 2.5 Typography scale (additions only)

```
fontSize: {
  // existing sizes stay
  'display-section': ['5.625rem', { lineHeight: '0.9', letterSpacing: '-0.03em', fontWeight: '400' }],  // 90px product titles
  'display-hero':    ['4.375rem', { lineHeight: '0.9', letterSpacing: '-0.03em', fontWeight: '400' }],  // 70px hero (update)
}
```

---

## 3. Structural Changes

### 3.1 Dark/Light Section System

The core yield.xyz pattern is alternating dark full-bleed sections with white rounded-top cards/sections. Implementation approach:

**New layout component: `DarkSection`**
```
- Full-width dark background (#131517)
- Contains content at max-w-[1200px]
- Supports optional background glow (radial gradients in accent colors)
- Supports optional parallax-decorated elements (floating coins/3D → our animated puzzle tiles)
```

**New layout component: `LightRevealSection`**
```
- White background with rounded-t-[60px] top corners
- Creates the "curving up from dark" effect
- Padding and content container inside
- z-10 to overlap previous dark section
```

**Section stacking pattern (landing page):**
```
<DarkSection>           ← Hero + nav (dark bg, glowing background)
<LightRevealSection>    ← Stats strip + product overview (white, curves up)
<DarkSection>           ← Feature grid / bento cards (dark bg, glow accents)
<LightRevealSection>    ← How it works / steps (white)
<DarkSection>           ← Agent classes (dark bg)
<DarkSection>           ← Quote/testimonial carousel
<LightRevealSection>    ← CTA + footer (white, curves up)
```

### 3.2 Card System Overhaul

**Current Card variants:** `static | interactive | elevated`

**New Card variants to add:**

| Variant | BG | Radius | Shadow | Context |
|---------|-----|--------|--------|---------|
| `float` | white | 30px | card-float | White card floating on dark section |
| `dark` | #1E2023 | 20px | none | Dark card on dark section (feature grid) |
| `dark-glass` | rgba(255,255,255,0.06) | 20px | none | Translucent on dark |
| `bento` | white | 30px | card-float | Larger bento grid card with overflow content |

### 3.3 Button System Updates

**Current pill buttons (md/lg):** `rounded-full` → already pill-shaped, good.

**Changes needed:**
- Primary variant on dark sections: dark bg (`#1E2023`) with white text, `rounded-[48px]`, icon circle on right with accent gradient
- Ghost variant on dark: `rgba(255,255,255,0.06)` bg, white text, `rounded-[40px]`
- Nav contact button on dark: `rgba(0,0,0,0.2)` bg, white text, `rounded-[40px]`
- All transitions: `0.5s cubic-bezier(0.4, 0, 0.2, 1)` (slower and smoother than current 150ms)

**New: IconButton sub-component**
yield.xyz primary buttons have a small gradient circle with an arrow icon on the right. Add this as an optional `icon` prop or `IconButton` wrapper.

```
<GlowButton variant="primary-dark" size="lg" icon>
  Start Building
</GlowButton>
```
→ renders: [Start Building ●→] where ● is a small circle with the accent gradient and an arrow SVG inside.

### 3.4 Parallax System

**Current:** No parallax. Just `Reveal` (fade-up on scroll via IntersectionObserver).

**Target:** Decorative elements move at different scroll speeds.

**Implementation options (in order of preference):**

1. **Framer Motion `useScroll` + `useTransform`** — Already have framer-motion installed. Use `useScroll` to get scroll progress, `useTransform` to map it to translateY on decorative elements. No new dependency needed.

2. CSS-only parallax via `perspective` + `translateZ` — No JS needed but less control.

3. Locomotive Scroll — What yield.xyz uses. Would require adding a dependency and wrapping the entire page. Heavier approach.

**Recommendation: Option 1 (Framer Motion)**

```tsx
// New hook: useParallax.ts
function useParallax(speed: number = 0.15) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });
  const y = useTransform(scrollYProgress, [0, 1], [-50 * speed, 50 * speed]);
  return { ref, y };
}
```

**Usage:** Apply to floating decorative elements (our animated puzzle tiles, abstract shapes, glowing orbs).

### 3.5 Background Glow System

yield.xyz uses layered radial gradients + blurred PNG images to create ambient light behind content sections.

**New CSS utility: `.section-glow`**
```css
.section-glow-violet {
  position: absolute;
  width: 600px; height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(123,63,228,0.12) 0%, transparent 65%);
  filter: blur(80px);
  pointer-events: none;
}

.section-glow-warm {
  position: absolute;
  width: 500px; height: 500px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,99,47,0.08) 0%, rgba(255,94,141,0.06) 40%, transparent 70%);
  filter: blur(80px);
  pointer-events: none;
}
```

These get positioned absolutely inside dark sections and parallax-shifted for depth.

---

## 4. Component-by-Component Changes

### 4.1 LandingNav
- Dark transparent background on dark sections (already glass-like)
- White logo on dark bg, dark logo on light bg (use scroll position to toggle)
- "Sign up" button with icon circle (accent gradient)
- "Contact us" ghost button with `rgba(0,0,0,0.2)` bg
- Mobile menu: white card with `rounded-[20px]`, similar to yield.xyz dropdown

### 4.2 Hero Section
- **Background:** Dark (`#131517`) instead of light cream
- **Background effects:** Warm glows (pink/amber/violet) instead of just violet dot grid
- **Headline:** White text, keep Instrument Serif but bump to 70px, -2px letter-spacing
- **Sub-headline:** `txt-on-dark-muted` color
- **CTA buttons:** Primary dark variant with icon circle + ghost "View docs"
- **Logo/illustration:** Keep animated puzzle but increase size, add parallax offset
- **Stats strip:** Integrated into dark hero section, not a separate section
- **Partner logos:** White SVGs on dark bg with marquee + edge fade gradient

### 4.3 Feature Grid (new Bento layout)
Replace the current flat grid of cards with a yield.xyz-style bento grid:

```
┌─────────────────────┬──────────────────────┐
│                     │                      │
│  Video/Animation    │  Text card           │
│  (large card)       │  (heading + body     │
│                     │   + CTA button)      │
│                     │                      │
├─────────────────────┼──────────────────────┤
│                     │                      │
│  Text card with     │  Video/Animation     │
│  dark bg texture    │  (large card)        │
│                     │                      │
└─────────────────────┴──────────────────────┘
```

Each card in the grid:
- `rounded-[20px]`
- White cards: full white bg
- Dark cards: `#1E2023` with a subtle texture background image
- Cards contain: H3 (serif, 40px), separator line, body text, "Learn more →" ghost button
- Animated content (our puzzle visualization, chart previews) in the media slots

### 4.4 Agent Classes Section
- Move to dark background section
- Cards become `float` variant (white on dark, `rounded-xl` → `rounded-[30px]`)
- "Popular" badge gets accent gradient instead of violet tint
- On hover: slight translateY(-4px) with shadow-card-float

### 4.5 Quote/Testimonial Section (new)
- Dark bg with warm glow effects
- Large serif quote text (white)
- Arrow left/right navigation buttons
- Attribution below
- Optional: decorative floating elements with parallax

### 4.6 Footer
- Dark background section
- White logo
- Grid of links with `txt-on-dark-muted` color
- Legal disclaimer text at bottom
- Large "Sign up" CTA button before footer links

---

## 5. Key CSS Patterns to Implement

### 5.1 The "Dark-to-Light Curve"
```css
.section-light-reveal {
  background: white;
  border-radius: 60px 60px 0 0;
  position: relative;
  z-index: 10;
  margin-top: -40px; /* overlap dark section */
}
```

### 5.2 Floating Card on Dark
```css
.card-float {
  background: white;
  border-radius: 30px;
  padding: 20px;
  box-shadow: 0 8px 35px rgba(0,0,0,0.36);
}
```

### 5.3 Accent Gradient (for icons/badges)
```css
.accent-gradient {
  background: linear-gradient(318.62deg, #FF632F 18.63%, #FF5E8D 38.24%, #FFCE86 81.03%);
}
```

### 5.4 Edge-Fade Marquee
```css
.marquee-container {
  mask-image: linear-gradient(90deg, #FFF 4%, transparent 17%, transparent 78%, #FFF 98%);
}
```

### 5.5 Smooth Transition Standard
```css
.transition-smooth {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 6. New Assets Needed

| Asset | Purpose | Format |
|-------|---------|--------|
| Background glow images | Ambient light effects on dark sections | PNG/WebP with transparency |
| Section texture | Subtle noise/grid for dark card backgrounds | PNG tile |
| Decorative 3D elements | Replace coins → use our puzzle tiles or abstract shapes | SVG/animated component |
| Product demo videos | Show dashboard, deploy flow, agent execution | MP4 (optional, can use animated components) |
| Partner logos (white) | White versions for dark background | SVG |

---

## 7. Implementation Order

### Phase 1: Foundation
1. Update `tailwind.config.ts` with new color tokens, radius, shadows, transitions
2. Update `globals.css` with dark section utilities, glow effects, new transition timing
3. Create `DarkSection` and `LightRevealSection` layout components
4. Update `Card` component with new variants (`float`, `dark`, `dark-glass`)

### Phase 2: Landing Page Restructure
5. Restructure `page.tsx` into dark/light alternating sections
6. Update hero to dark bg with warm glows and white text
7. Update nav for dark/light context switching
8. Convert stats strip to dark inline section
9. Add partner logo marquee on dark bg

### Phase 3: Feature Polish
10. Build bento grid feature section
11. Add parallax hook using Framer Motion `useScroll`
12. Position decorative parallax elements (puzzle tiles, glowing orbs)
13. Update button variants (primary-dark with icon circle, ghost-dark)
14. Add accent gradient usage on badges and icon circles

### Phase 4: Content Sections
15. Update Agent Classes section to dark bg with float cards
16. Build testimonial/quote carousel section
17. Update economics section styling
18. Update FAQ section
19. Update footer to dark

### Phase 5: App Pages
20. Consider dark sidebar or dark header for app pages (optional)
21. Update forms/inputs to match new card contrast patterns
22. Ensure all existing components work in both dark and light contexts

---

## 8. What NOT to Change

- **Fonts:** Instrument Serif + DM Sans + JetBrains Mono work well. No need to switch to ITC Garamond / SF Pro Display. Our font pairing already achieves the same serif-display + clean-sans pattern.
- **Brand color:** Keep violet `#7B3FE4` as primary. Add the warm accent gradient as a secondary, not a replacement.
- **App dashboard:** The app itself should stay light/functional. The dark treatment is primarily for the landing page and marketing sections.
- **Component API:** Keep the same `variant`/`size` prop patterns. Just add new variants.
- **Framer Motion:** Already installed. Use it for parallax instead of adding Locomotive Scroll.
- **Reveal animations:** Keep the IntersectionObserver pattern, just adjust timing to 0.5s ease-out.

---

## 9. Reference: yield.xyz Design Tokens (exact values)

### Colors (extracted from computed styles)
```
Dark bg:        rgb(19, 21, 23)  → #131517
Text on dark:   rgb(255, 255, 255)
Text muted:     rgb(135, 130, 133) → #878285
Text subtle:    rgb(80, 86, 89) → #505659
Card light bg:  rgb(247, 247, 247) → #F7F7F7
Card warm gray: rgb(237, 235, 233) → #EDEBE9
```

### Gradients
```
Accent:    linear-gradient(318.62deg, #FF632F 18.63%, #FF5E8D 38.24%, #FFCE86 81.03%)
Marquee:   linear-gradient(90deg, #FFF 4%, transparent 17.38%, transparent 78.08%, #FFF 97.73%)
```

### Border Radii
```
Buttons:     40px (ghost), 48px (primary CTA)
Cards:       20px (small), 30px (medium), 56px (pill badges)
Sections:    60px 60px 0 0 (light section top reveal)
Icons:       20px (square icons), full (circular)
```

### Transitions
```
All interactive: 0.5s cubic-bezier(0.4, 0, 0.2, 1)
```

### Parallax speeds
```
Slow decorative: data-speed="0.15" (coins, large elements)
Subtle:          data-speed="0.1"  (smaller elements)
```

### Shadows
```
Primary CTA: rgba(0,0,0,0.36) 8px 12.8px 35.3px
Cards on dark: similar depth shadow for floating effect
```

### Fonts
```
Headings: ITCGaramondStd-LtCond (serif, weight 400)
Body:     SF Pro Display (sans, weights 400/600)
→ Our equivalent: Instrument Serif / DM Sans (already close)
```
