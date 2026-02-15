'use client';

/**
 * Claude mascot silhouette — exact proportions from the official SVG.
 *
 * Original mascot bounding box: x 270–503, y 205–351 (233 × 146 px)
 * Scaled ×4.72 to fit 1200×1000 viewBox centered.
 *
 * Anatomy:
 *   HEAD  — wide rectangle top (x 187–1013, y 156–430)
 *   ARMS  — two blocks extending outward below the head
 *           Left  (x  50–187, y 430–576)
 *           Right (x 1013–1150, y 430–576)
 *   BODY  — connector between arms and legs (x 187–1013, y 576–713)
 *   LEGS  — 4 narrow vertical strips in two pairs:
 *           Leg 1 (x 244–328), Leg 2 (x 376–465)  ← left pair
 *           Leg 3 (x 734–824), Leg 4 (x 871–961)  ← right pair
 *           Wide center gap between pairs (x 465–734)
 *           Narrow gaps within pairs (x 328–376, x 824–871)
 *   EYES  — two narrow vertical cutouts in the head
 *           Left  (x 328–376, y 298–430)
 *           Right (x 824–871, y 298–430)
 *   SHELVES — short flat ledges connecting body bottom to outermost legs
 *           Left  (x 187–244), Right (x 961–1013)
 *
 * ViewBox: 0 0 1200 1000
 */
/* ── Path builders ──────────────────────────────────────────────── */

/** Body + head + legs (NO arms) — arms are separate for animation */
function buildBodyPath(): string {
  const r = 20;
  const lr = 14;
  const cr = 12;
  const jr = 14;

  const bx1 = 187, by1 = 156, bx2 = 1013;
  const gapY = 713;
  const legBot = 845;
  const shL = 244, shR = 961;
  const l1R = 328, l2L = 376, l2R = 465;
  const l3L = 734, l3R = 824, l4L = 871;

  return [
    `M ${bx1 + r},${by1}`,
    `H ${bx2 - r}`,
    `Q ${bx2},${by1} ${bx2},${by1 + r}`,

    // Right side straight down (arm area handled separately)
    `V ${gapY - jr}`,
    `Q ${bx2},${gapY} ${bx2 - jr},${gapY}`,

    // Right shelf → Leg 4
    `H ${shR + jr}`,
    `Q ${shR},${gapY} ${shR},${gapY + jr}`,
    `V ${legBot - lr}`,
    `Q ${shR},${legBot} ${shR - lr},${legBot}`,
    `H ${l4L + lr}`,
    `Q ${l4L},${legBot} ${l4L},${legBot - lr}`,

    `V ${gapY + cr}`,
    `C ${l4L},${gapY} ${l4L},${gapY} ${l4L - cr},${gapY}`,
    `H ${l3R + cr}`,
    `C ${l3R},${gapY} ${l3R},${gapY} ${l3R},${gapY + cr}`,

    `V ${legBot - lr}`,
    `Q ${l3R},${legBot} ${l3R - lr},${legBot}`,
    `H ${l3L + lr}`,
    `Q ${l3L},${legBot} ${l3L},${legBot - lr}`,

    `V ${gapY + cr}`,
    `C ${l3L},${gapY} ${l3L},${gapY} ${l3L - cr},${gapY}`,
    `H ${l2R + cr}`,
    `C ${l2R},${gapY} ${l2R},${gapY} ${l2R},${gapY + cr}`,

    `V ${legBot - lr}`,
    `Q ${l2R},${legBot} ${l2R - lr},${legBot}`,
    `H ${l2L + lr}`,
    `Q ${l2L},${legBot} ${l2L},${legBot - lr}`,

    `V ${gapY + cr}`,
    `C ${l2L},${gapY} ${l2L},${gapY} ${l2L - cr},${gapY}`,
    `H ${l1R + cr}`,
    `C ${l1R},${gapY} ${l1R},${gapY} ${l1R},${gapY + cr}`,

    `V ${legBot - lr}`,
    `Q ${l1R},${legBot} ${l1R - lr},${legBot}`,
    `H ${shL + lr}`,
    `Q ${shL},${legBot} ${shL},${legBot - lr}`,

    `V ${gapY + jr}`,
    `Q ${shL},${gapY} ${shL - jr},${gapY}`,
    `H ${bx1 + jr}`,
    `Q ${bx1},${gapY} ${bx1},${gapY - jr}`,

    // Left side straight up (arm area handled separately)
    `V ${by1 + r}`,
    `Q ${bx1},${by1} ${bx1 + r},${by1}`,

    'Z',
  ].join(' ');
}

/** Left arm — rounded rect with overlap into body so rotation doesn't leave gaps */
function buildLeftArmPath(): string {
  const ar = 18;
  const bx1 = 187, armY1 = 430, armY2 = 576, laX = 50;
  const overlap = 12;

  return [
    `M ${bx1 + overlap},${armY1}`,
    `H ${laX + ar}`,
    `Q ${laX},${armY1} ${laX},${armY1 + ar}`,
    `V ${armY2 - ar}`,
    `Q ${laX},${armY2} ${laX + ar},${armY2}`,
    `H ${bx1 + overlap}`,
    'Z',
  ].join(' ');
}

/** Right arm — mirror of left */
function buildRightArmPath(): string {
  const ar = 18;
  const bx2 = 1013, armY1 = 430, armY2 = 576, raX = 1150;
  const overlap = 12;

  return [
    `M ${bx2 - overlap},${armY1}`,
    `H ${raX - ar}`,
    `Q ${raX},${armY1} ${raX},${armY1 + ar}`,
    `V ${armY2 - ar}`,
    `Q ${raX},${armY2} ${raX - ar},${armY2}`,
    `H ${bx2 - overlap}`,
    'Z',
  ].join(' ');
}

const BODY_D = buildBodyPath();
const LEFT_ARM_D = buildLeftArmPath();
const RIGHT_ARM_D = buildRightArmPath();

/* ── Eye coordinates ────────────────────────────────────────────── */

const LEFT_EYE = { x: 328, y: 298, w: 48, h: 132, rx: 10 };
const RIGHT_EYE = { x: 824, y: 298, w: 47, h: 132, rx: 10 };


/* ── Partner logos (same as hero) ───────────────────────────────── */

const TOKEN_LOGOS = [
  { name: 'BRETT', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4.png', href: '#' },
  { name: 'TOSHI', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4.png', href: '#' },
  { name: 'DEGEN', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x4ed4e862860bed51a9570b96d89af5e1b0efefed.png', href: '#' },
  { name: 'AERO', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x940181a94a35a4569e4529a3cdfb74e38fd98631.png', href: '#' },
  { name: 'VIRTUAL', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b.png', href: '#' },
  { name: 'nad.fun', src: '/logos/nad.svg', href: 'https://nad.fun' },
  { name: 'HIGHER', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x0578d8a44db98b23bf096a382e016e29a5ce0ffe.png', href: '#' },
  { name: 'MFER', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0xe3086852a4b125803c815a158249ae468a3254ca.png', href: '#' },
  { name: 'KEYCAT', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x9a26f5433671751c3276a065f57e5a02d2817973.png', href: '#' },
  { name: 'DOG', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x6921b130d297cc43754afba22e5eac0fbf8db75b.png', href: '#' },
  { name: 'BANKR', src: 'https://dd.dexscreener.com/ds-data/tokens/base/0x22af33fe049f1a438958d0e2f93ef3a9a02b4e3e.png', href: '#' },
  { name: 'CHOG', src: '/logos/monad.svg', href: 'https://monad.xyz' },
];


/* ── Main component ─────────────────────────────────────────────── */

export function OrganicCapabilities() {
  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      <div className="section-glow section-glow-violet" style={{ bottom: '10%', right: '-5%' }} aria-hidden="true" />

      <div className="mx-3 sm:mx-5 md:mx-8 lg:mx-12 relative z-[1]">
        {/* Section header */}
        <div className="text-center mb-0">
          <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-4">
            Capabilities
          </p>
          <h2 className="font-display text-[clamp(2rem,4vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-white">
            Autonomous <em className="italic" style={{ color: '#A78BFA' }}>Market Making</em>
          </h2>
          <p className="font-display text-[clamp(1.2rem,2.5vw,2rem)] leading-[1.2] tracking-[-0.01em] text-white/50 mt-2">
            for every token on <span style={{ color: '#3c8aff' }}>Monad</span>.
          </p>
        </div>

        {/* Claude mascot shape container — gentle idle float */}
        <div
          className="relative w-full -mt-10 md:-mt-16"
          style={{
            aspectRatio: '1200 / 1000',
            animation: 'mascot-float 5s ease-in-out infinite',
          }}
        >
          {/* SVG — Claude mascot silhouette with animated blinking eyes */}
          <svg
            viewBox="0 0 1200 1000"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <style>{`
              @keyframes mascot-blink {
                0%, 78%, 100% { transform: scaleY(1); }
                80% { transform: scaleY(0.05); }
                82% { transform: scaleY(0.7); }
                84% { transform: scaleY(0.05); }
                88% { transform: scaleY(1); }
              }
              @keyframes arm-wave-l {
                0%, 25%, 100% { transform: rotate(0deg); }
                3%  { transform: rotate(-5deg); }
                5%  { transform: rotate(4deg); }
                7%  { transform: rotate(-3.5deg); }
                9%  { transform: rotate(3deg); }
                11% { transform: rotate(-2deg); }
                13% { transform: rotate(1.5deg); }
                15% { transform: rotate(-0.5deg); }
              }
              @keyframes arm-wave-r {
                0%, 55%, 100% { transform: rotate(0deg); }
                57% { transform: rotate(5deg); }
                59% { transform: rotate(-4deg); }
                61% { transform: rotate(3.5deg); }
                63% { transform: rotate(-3deg); }
                65% { transform: rotate(2deg); }
                67% { transform: rotate(-1.5deg); }
                69% { transform: rotate(0.5deg); }
              }
              .mascot-eye {
                transform-box: fill-box;
                transform-origin: center;
              }
              .mascot-eye-l {
                animation: mascot-blink 5s ease-in-out infinite;
              }
              .mascot-eye-r {
                animation: mascot-blink 5s ease-in-out 0.03s infinite;
              }
              .mascot-arm-l {
                transform-origin: 187px 503px;
                animation: arm-wave-l 7s ease-in-out infinite;
              }
              .mascot-arm-r {
                transform-origin: 1013px 503px;
                animation: arm-wave-r 7s ease-in-out infinite;
              }
            `}</style>

            <defs>
              <mask id="mascot-mask">
                {/* Body (head + torso + legs) */}
                <path d={BODY_D} fill="white" />
                {/* Left arm — animated wobble */}
                <g className="mascot-arm-l">
                  <path d={LEFT_ARM_D} fill="white" />
                </g>
                {/* Right arm — animated wobble */}
                <g className="mascot-arm-r">
                  <path d={RIGHT_ARM_D} fill="white" />
                </g>
                {/* Eye holes */}
                <rect
                  className="mascot-eye mascot-eye-l"
                  x={LEFT_EYE.x} y={LEFT_EYE.y}
                  width={LEFT_EYE.w} height={LEFT_EYE.h}
                  rx={LEFT_EYE.rx}
                  fill="black"
                />
                <rect
                  className="mascot-eye mascot-eye-r"
                  x={RIGHT_EYE.x} y={RIGHT_EYE.y}
                  width={RIGHT_EYE.w} height={RIGHT_EYE.h}
                  rx={RIGHT_EYE.rx}
                  fill="black"
                />
              </mask>
            </defs>

            {/* White shape masked by body + animated arms + eye holes */}
            <rect width="1200" height="1000" fill="white" mask="url(#mascot-mask)" />

          </svg>

          {/* Overlay content — tagline + deploy CTA + logo carousel */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-[12%]" style={{ marginTop: '-8%' }}>

            <h3 className="font-display leading-[1.08] tracking-[-0.03em] text-[#1A1A2E]" style={{ fontSize: 'clamp(1.2rem, 4.5cqw, 3.75rem)' }}>
              Built for<br />
              serious operators<br />
              <em className="hero-em">on silly markets.</em>
            </h3>

            <div className="mt-[clamp(0.6rem,2.2cqw,2rem)]">
              <a href="/app/deploy" className="cta-pill" style={{ padding: 'clamp(0.3rem,0.8cqw,0.875rem) clamp(0.5rem,1.2cqw,1rem) clamp(0.3rem,0.8cqw,0.875rem) clamp(0.8rem,1.8cqw,1.75rem)', fontSize: 'clamp(0.4rem,1cqw,0.9375rem)' }}>
                Deploy Capital
                <span className="cta-pill-icon" style={{ width: 'clamp(14px,2.5cqw,32px)', height: 'clamp(14px,2.5cqw,32px)' }}>
                  <svg width="50%" height="50%" viewBox="0 0 14 14" fill="none">
                    <path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </a>
            </div>


          </div>
        </div>
      </div>
    </section>
  );
}
