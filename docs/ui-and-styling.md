# UI and styling

## 1. CSS files

- `style.css` (about 4,000 lines) — main stylesheet: tokens, reset, base elements, auth, layout, components, states, toast, responsive, motion/print.
- `styles/glass.css` (about 870 lines) — glass theme layer (surfaces, blur, borders).

Both are loaded by `index.html`: `style.css` then `styles/glass.css`.

## 2. Design tokens

CSS custom properties under `:root`: backgrounds (`--bg`, `--bg-primary`), glass surfaces (`--glass-surface`, `--glass-card`, ...), borders (`--border`, `--border-strong`), text (`--text`, `--muted`), accents (`--primary`, `--primary-dark`), status colors (`--success`, `--warning`, `--danger`), blur (`--blur`).

## 3. Layout

- Sidebar (`#sidebar`) with brand, user mini, nav, footer (backend selector), logout.
- Main content with topbar (`#topbar`) and `#pageContent`.
- Responsive: mobile menu toggle, sidebar collapse under 1024px.

## 4. Components

Buttons (`.btn`, variants primary/secondary/danger), form groups, cards (`.content-card`), tables (`.data-table`), modals (`.modal`), toasts, status badges, pagination bars, filter bars, stat cards, quick action cards.

## 5. States

Loading spinners, empty states (`.empty-state`), error states, success headers. Helper functions `stateHTML` / `tableStateHTML` / `setButtonLoading`.

## 6. Accessibility

ARIA roles on navigation, modals, alerts; `aria-live` on toasts and pagination; keyboard focus on login fields; password show/hide toggles.

## 7. Inactive styles

The `frontend/css/*` files (tokens, base, layout, components, pages, responsive) belong to the incomplete modular frontend and are not loaded by the active app.