# Demo media

These files show the actual app, not design mockups. Screenshots are produced by
`scripts/browser-check.mjs`; the video records `scripts/record-demo.mjs`.

```sh
npm ci
npx playwright install chromium
npm start
# In another terminal:
npm run test:browser
npm run demo:record
ffmpeg -y -i test-results/demo.webm -c:v libx264 -crf 25 -pix_fmt yuv420p -movflags +faststart -an docs/media/demo.mp4
ffmpeg -y -i docs/media/demo.mp4 -vf 'fps=7,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80[p];[s1][p]paletteuse=dither=bayer' -loop 0 docs/media/demo.gif
```

If Chromium is supplied by your environment, set
`CHROMIUM_EXECUTABLE=/path/to/chromium`. Browser code is a development dependency;
the application itself needs only a static web server. Screenshots are desktop
1500 px wide and mobile 390 px wide. Demo captions are added by the recording
script and do not appear in the product.
