# Light theme

Turn on Light theme in Features or open the map with `?light`. Choose Warm paper, Cool studio, High contrast, or Glass in the look switch. The choice stays in this browser while the feature is on. Draw keeps its dark paper for its bright ink.

Glass is optional and off by default. Its warm translucent panels, soft blur and bright reflected edges change only the paint of the chat, map cards and controls. Reduced transparency uses opaque warm surfaces. A 1920 × 1080 example is saved in `docs/looks/glass.png`.

For filming, choose **Warm paper**: its warmer background gives the map a softer, more inviting frame while keeping the ink and controls clear. The check saves three 1920 × 1080 example-map captures to a temporary directory; set `LIGHT_THEME_SHOTS` to choose another output directory.

`node ui/src/bricks/light-theme/glass-check.mjs` checks Glass and writes its screenshot to a temporary directory too; `LIGHT_THEME_SHOTS` also selects its output directory.

Agent work (`?canvas=code`) is a separate application entry that does not mount features, so this feature cannot style that page without a shared entry-point change.
