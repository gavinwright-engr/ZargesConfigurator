# Demo media

These files show the actual app, not design mockups. Screenshots are produced by
`scripts/browser-check.mjs`; `scripts/render-closeup.mjs` also produces the
enlarged right-stack detail and checks label placement on all catalog models.
`scripts/workspace-check.mjs` captures `front-placement.png` after a real catalog
drag into the newly available floor space in front of the reference stacks.
`scripts/selection-check.mjs` checks visible and covered selection edges in all
three views and captures the selected middle-right case in `selection-detail.png`.
`scripts/record-demo.mjs` records the video, switches both scale references off
before the opening caption, and captures `demo-poster.png` for the README.
The person and ball appear briefly later in the tour, then are switched off again.
The MP4/GIF omit the first two seconds of browser setup. The script also verifies that
the recorded drag actually stacks the 29 L case on the 73 L base.
`npm run test:browser` runs the screenshot scripts alongside clipboard and
bounded-placement browser regressions.

```sh
npm ci
npx playwright install chromium
npm start
# In another terminal:
npm run test:browser
npm run demo:record
ffmpeg -y -ss 2 -i test-results/demo.webm -vf 'scale=in_range=pc:out_range=tv' -c:v libx264 -crf 22 -pix_fmt yuv420p -color_range tv -movflags +faststart -an docs/media/demo.mp4
ffmpeg -y -i docs/media/demo.mp4 -vf 'fps=7,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80[p];[s1][p]paletteuse=dither=bayer' -loop 0 docs/media/demo.gif
```

If Chromium is supplied by your environment, set
`CHROMIUM_EXECUTABLE=/path/to/chromium`. Browser code is a development dependency;
the application itself needs only a static web server. Screenshots are desktop
1500 px wide and mobile 390 px wide. Demo captions are added by the recording
script and do not appear in the product.
The explicit video range conversion preserves Chromium's full-range colors,
including the pale gray panels and floor grid, in the H.264 recording.
