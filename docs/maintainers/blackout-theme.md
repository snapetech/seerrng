# Blackout preview

Blackout is an opt-in palette based on Seerr, not a global replacement or a
desaturation filter. Select it from the existing header Theme picker. Existing
palettes and the default selection are unchanged; selection persists per browser.

The shared stylesheet owns all overlay colors. `--theme-overlay-*` aliases
preserve the original colors outside Blackout and become black inside it.
Control surface and hover tokens also become black; their alpha values remain
at each original component owner. Text, borders, semantic buttons/badges,
ratings, artwork, and selection colors remain unchanged.

Blackout appears immediately after SeerrNG in the picker. Its shared background
keeps the original 40-degree gradient geometry.
Only within Blackout, the lower-left is black, fading through #0e1c3a and #1a3260
to #284478. The upper-right gray spotlight is disabled only for Blackout.
The shared background tokens propagate to every existing gradient consumer,
including page backdrops, menu gradients, dialogs, and login backgrounds.
All existing gradient stop positions and alpha values remain unchanged.

Opacity inventory: cards/Settings 38%, inset panels 42%, artwork wash 46%,
artwork gradient 18/32/58%, full poster overlay 40/90%, compact poster overlay
0/88%, recent-request overlay 47/100%, header 80%, user menu 80%, theme picker
95%, mobile bottom menu 90%, loading overlay 75%. Existing form/control/hover
opacity variants remain exactly as declared in globals.css. The already black
80% modal screen backdrop is unchanged.

The sidebar uses the same Blackout gradient at 80% layer strength with 5px
backdrop blur, on both desktop and mobile sidebar instances. Text remains opaque.
Menu-only blue/sky variables preserve SeerrNG's active and hover colors without
changing Blackout's non-menu accent colors. No other theme receives overrides.

This laptop preview changes no server data or media-service configuration.
Visual inspection may be recorded separately, but it is not an approval gate
for production deployment or upstream publication when the maintainer explicitly
authorizes those actions. Applicable automated checks still apply.
