# Design system (v1)

Goals: premium, simple, fast, trustworthy, international. One set of tokens for site and Mini App.

| Token | Light | Dark | Notes |
|---|---|---|---|
| ink / text | `#0b1320` | `#e6edf6` | Mini App prefers Telegram `--tg-theme-*` values |
| muted | `#64748b` | `#94a3b8` | |
| bg / surface | `#ffffff` / `#f5f7fa` | `#0b1320` / `#111c2e` | |
| primary | `#0f766e` (teal-green) | `#2dd4bf` | buttons, links, progress |
| accent | `#b45309` | `#fbbf24` | warnings (trial ended) |
| radius | 14px cards, 8–10px controls, pill buttons on site | | |
| spacing | 16px base (`clamp` on site) | | |
| type | system UI stack + Vazirmatn / Noto Sans Arabic for Persian; no web-font downloads | | |

Components (Mini App `ui.tsx` + `styles.css`): buttons (primary, secondary, ghost, danger; min 44px touch target),
fields with visible labels, cards, list items, status badges, banners (trial/expired), progress bar, onboarding steps,
chips (filters), bottom tab bar, toast, skeleton loaders, empty states, error box with retry.

Accessibility: semantic landmarks, one `<h1>` per view, labels on every input, `aria-live` for async results,
`role=progressbar`, visible focus rings, reduced-motion support, contrast ≥ 4.5:1 for text on primary, RTL via
logical CSS properties. Accessibility bugs are product bugs.
