// SPDX-License-Identifier: Apache-2.0
// The figures style's vector parts: <symbol>s defined once, placed with <use>. Furniture
// lives in the desk's own coordinates (desk top face at y = 30, 96 wide, the monitor
// centred over x = 48); figure parts are drawn around the head's centre so one set serves
// the seated figure, the helper and the walker. Colours are custom properties on the
// cell: furniture (--o-top, --o-edge, --o-wood, --o-chair) and the look (--look-shirt,
// --look-hair, --look-skin, --look-trouser).

export const CELL_W = 150;
export const CELL_H = 120;
/** The seated figure's head centre and the standing figure's feet, desk coordinates. */
export const HEAD = { x: 48, y: 44 };
export const FEET = { x: 48, y: 70 };

const arm = (x1: number, y1: number, x2: number, y2: number, key: string, w = 2.2) => (
  <g key={key}>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--look-shirt)" strokeWidth={w} strokeLinecap="round" />
    <circle cx={x2} cy={y2 - 0.3} r="1.5" fill="var(--look-skin)" />
  </g>
);

export function OfficeDefs() {
  return (
    <svg className="office-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* desk: one top face with a darker front edge; keyboard centred under the monitor */}
        <symbol id="o-desk" overflow="visible">
          <rect x="0" y="30" width="96" height="14" rx="1" fill="var(--o-top)" />
          <rect x="0" y="42" width="96" height="2" fill="var(--o-edge)" />
          <rect x="38" y="36.5" width="20" height="3" rx="1" fill="var(--o-wood)" />
        </symbol>
        {/* monitor on the desk: 1 px bezel, foot touching the top face; the screen is drawn by the cell */}
        <symbol id="o-monitor" overflow="visible">
          <rect x="35" y="14" width="26" height="18" rx="1" fill="var(--o-wood)" />
          <rect x="47" y="32" width="2" height="2" fill="var(--o-wood)" />
          <rect x="43" y="34" width="10" height="1.5" rx="0.5" fill="var(--o-wood)" />
        </symbol>
        {/* lamp right of the monitor, drawn only on a needs_you desk */}
        <symbol id="o-lamp" overflow="visible">
          <rect x="66" y="33" width="8" height="1.5" rx="0.5" fill="var(--o-wood)" />
          <rect x="69.25" y="12" width="1.5" height="21" fill="var(--o-wood)" />
          <line x1="70" y1="13" x2="66" y2="9" stroke="var(--o-wood)" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M60 4 h10 l1.5 5 h-13 z"
            fill="var(--o-needs)"
            stroke="var(--o-needs)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </symbol>
        {/* mug, 5 × 6, at the origin: only in an idle hand */}
        <symbol id="o-mug" overflow="visible">
          <rect x="0" y="0" width="5" height="6" rx="0.8" fill="var(--o-wood)" />
          <path d="M5 1.5 h1.2 a1.5 1.5 0 0 1 0 3 h-1.2" fill="none" stroke="var(--o-wood)" strokeWidth="0.9" />
        </symbol>
        {/* chair back, painted behind the torso; pushed in when the desk is gone */}
        <symbol id="o-chair" overflow="visible">
          <rect x="42" y="56" width="12" height="10" rx="3" fill="var(--o-chair)" />
        </symbol>
        <symbol id="o-chair-in" overflow="visible">
          <rect x="42" y="44" width="12" height="9" rx="3" fill="var(--o-chair)" />
        </symbol>
        <symbol id="o-sheet" overflow="visible">
          <rect
            x="0"
            y="0"
            width="6"
            height="4"
            rx="0.5"
            fill="var(--o-sheet)"
            stroke="var(--o-wood)"
            strokeWidth="0.6"
          />
        </symbol>
        {/* side table for helpers with a laptop; the lid screen is drawn by the cell */}
        <symbol id="o-side" overflow="visible">
          <rect x="118" y="38" width="36" height="10" rx="1" fill="var(--o-top)" />
          <rect x="118" y="46" width="36" height="2" fill="var(--o-edge)" />
          <rect x="124" y="30" width="12" height="8.5" rx="1" fill="var(--o-wood)" />
        </symbol>
        <symbol id="o-stool" overflow="visible">
          <rect x="0" y="0" width="10" height="3" rx="1.5" fill="var(--o-chair)" />
        </symbol>
        {/* the plant and the clock ring (plan view) */}
        <symbol id="o-plant" overflow="visible">
          <circle cx="5" cy="5" r="5" fill="var(--o-leaf)" />
        </symbol>
        <symbol id="o-clock" overflow="visible">
          <circle cx="6" cy="6" r="5.3" fill="none" stroke="var(--o-wood)" strokeWidth="1" />
        </symbol>

        {/* ---- the person, around the head's centre; seen from behind, 3/4 turn ---- */}
        <symbol id="o-head" overflow="visible">
          <circle cx="0" cy="0" r="3.5" fill="var(--look-skin)" />
        </symbol>
        <symbol id="o-hair-0" overflow="visible">
          <path d="M-3.5 0 a3.5 3.5 0 1 1 7 0 v1.6 h-7 z" fill="var(--look-hair)" />
        </symbol>
        <symbol id="o-hair-1" overflow="visible">
          <path d="M-3.5 0 a3.5 3.5 0 1 1 7 0 l2 1.6 h-9 z" fill="var(--look-hair)" />
        </symbol>
        <symbol id="o-hair-2" overflow="visible">
          <path d="M-3.5 0 a3.5 3.5 0 1 1 7 0 v1 h-7 z" fill="var(--look-hair)" />
          <circle cx="0" cy="1.8" r="2" fill="var(--look-hair)" />
        </symbol>
        <symbol id="o-hair-3" overflow="visible">
          <circle cx="0" cy="-0.3" r="4.4" fill="var(--look-hair)" />
          <circle cx="-3.6" cy="-2.6" r="1.4" fill="var(--look-hair)" />
          <circle cx="3.6" cy="-2.6" r="1.4" fill="var(--look-hair)" />
          <circle cx="0" cy="-4.6" r="1.4" fill="var(--look-hair)" />
          <circle cx="-4.4" cy="0.8" r="1.3" fill="var(--look-hair)" />
          <circle cx="4.4" cy="0.8" r="1.3" fill="var(--look-hair)" />
        </symbol>
        <symbol id="o-glasses" overflow="visible">
          <line x1="3.2" y1="-0.4" x2="5.2" y2="-1" stroke="var(--fg)" strokeWidth="1" strokeLinecap="round" />
        </symbol>
        {/* seated torso 10 × 12 with 12 px shoulders, a 1 px neck */}
        <symbol id="o-neck" overflow="visible">
          <rect x="-1" y="2.6" width="2" height="1.4" fill="var(--look-skin)" />
        </symbol>
        <symbol id="o-torso" overflow="visible">
          <path d="M-6 7 a3 3 0 0 1 3 -4 h6 a3 3 0 0 1 3 4 v0.5 l-1 7.5 h-10 l-1 -7.5 z" fill="var(--look-shirt)" />
        </symbol>
        {/* arms: right to the keyboard with a left hint · right to the mug · both on the desk */}
        <symbol id="o-arm-key" overflow="visible">
          <line x1="-4.5" y1="6" x2="-3" y2="1" stroke="var(--look-shirt)" strokeWidth="1" strokeLinecap="round" />
          {arm(4.5, 6, 1, -6.5, "r")}
        </symbol>
        <symbol id="o-arm-mug" overflow="visible">
          {arm(4.5, 6, 8, 0, "r")}
        </symbol>
        <symbol id="o-arms-desk" overflow="visible">
          {arm(-4.5, 5, -7, -6, "l")}
          {arm(4.5, 5, 7, -6, "r")}
        </symbol>
        {/* standing figure, feet at the origin: 26 tall, 12 wide, 6 px legs */}
        <symbol id="o-stand" overflow="visible">
          <rect x="-1" y="-19.4" width="2" height="1.4" fill="var(--look-skin)" />
          <path d="M-6 -15 a3 3 0 0 1 3 -4 h6 a3 3 0 0 1 3 4 v0.5 l-1 8.5 h-10 l-1 -8.5 z" fill="var(--look-shirt)" />
        </symbol>
        <symbol id="o-legs" overflow="visible">
          <line
            x1="-2.5"
            y1="-6"
            x2="-2.5"
            y2="0"
            stroke="var(--look-trouser)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line x1="2.5" y1="-6" x2="2.5" y2="0" stroke="var(--look-trouser)" strokeWidth="2.4" strokeLinecap="round" />
        </symbol>
        <symbol id="o-legs-a" overflow="visible">
          <line
            x1="-2.5"
            y1="-6"
            x2="-4.5"
            y2="0"
            stroke="var(--look-trouser)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line x1="2.5" y1="-6" x2="4.5" y2="0" stroke="var(--look-trouser)" strokeWidth="2.4" strokeLinecap="round" />
        </symbol>
        <symbol id="o-legs-b" overflow="visible">
          <line
            x1="-2.5"
            y1="-6"
            x2="-0.5"
            y2="0"
            stroke="var(--look-trouser)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line x1="2.5" y1="-6" x2="0.5" y2="0" stroke="var(--look-trouser)" strokeWidth="2.4" strokeLinecap="round" />
        </symbol>
        <symbol id="o-arm-up" overflow="visible">
          {arm(5, -16, 9, -23, "r")}
        </symbol>
        <symbol id="o-arm-down" overflow="visible">
          {arm(-5, -16, -5.5, -8, "l", 1.6)}
        </symbol>
        <symbol id="o-arms-stand" overflow="visible">
          {arm(-5, -16, -5.5, -8, "l", 1.6)}
          {arm(5, -16, 5.5, -8, "r", 1.6)}
        </symbol>
      </defs>
    </svg>
  );
}
