# Label Check: alcohol label verification prototype

A web app that reads an alcohol beverage label image and checks it against the
data on the COLA application, the routine "does the label match the form?"
work that takes up much of a compliance agent's day.

**Live app:** _see the deployed URL in the repository description_

- **Check one label:** pick an image, type in the application values, press **Check label**. Results take about 1 second.
- **Check many labels:** drop in hundreds of images plus one CSV of application data. You get a running tally, a sortable table and a downloadable results CSV.
- **Try it without any files:** use *Or try an example label* (one label) or *Load the example batch* (9 labels).

## What it checks

| Field | How it is judged |
|---|---|
| Brand name, class/type, bottler name and address, country of origin | Same wording = **Match**, even if capitalization or punctuation differs (`STONE'S THROW` vs `Stone's Throw`) and accents are lost (`CHATEAU` vs `Château`). Close but not identical = **Check by eye**. Missing = **Mismatch**. |
| Alcohol content | Compares the numbers, not the text: `45%` = `45% Alc./Vol.`. Also confirms that any proof on the label equals 2 × ABV. |
| Net contents | Converts units before comparing: `12 FL. OZ.` = `355 mL`, `75 cl` = `750 mL`. |
| Government Health Warning | Must be **word for word** (27 CFR 16.21). `GOVERNMENT WARNING:` must be in capitals (title case is rejected) and in **bold**. Boldness is measured from stroke thickness. Changed or missing words → **Mismatch**. A word that looks like a scanner misread (`pecause` for `because`) → **Check by eye**, with that word highlighted. |

Every label gets one of three overall results: **Match**, **Check by eye** or
**Mismatch**, always shown in words and with an icon, not by color alone. Each
field shows *Application: …* next to *On label: …* so the agent can see why.

## Approach and key decisions

These decisions come from the stakeholder interviews:

1. **The OCR runs in the browser and nothing goes to a cloud API.** Marcus said the
   network blocks many outbound domains, and the last vendor's ML endpoints were
   firewalled. This app uses [Tesseract.js](https://github.com/naptha/tesseract.js)
   (WebAssembly), and the app serves the engine and English model files itself
   (`scripts/copy-ocr-assets.mjs`). At runtime the only requests go to the app's
   own host, which the headless test verified. Label images never leave the
   agent's computer, so there are no PII, storage or retention questions for the
   prototype.
2. **Speed.** Sarah's limit is about 5 seconds. A single label takes about **1 s**
   (0.7–1.4 s measured); a batch runs at about **0.8 s per label** with parallel workers,
   so a 300-label importer drop takes about 4 minutes, unattended. The engine starts
   loading when the page opens, so the first check is not slowed down.
3. **Two OCR passes, in parallel.** The default layout mode reads paragraphs (the
   warning) well, but it can skip large decorative headline text (it missed
   `OLD TOM DISTILLERY`). A second "sparse text" pass catches it. Both run at once
   on two workers.
4. **Judgment, not just pattern matching** (Dave). Comparisons ignore case and
   punctuation where that doesn't change meaning. The tool sends uncertain cases
   to **Check by eye** instead of guessing, and it never rejects a label because
   of a likely misread. The warning check is the exception (Jenny): any real
   wording change there is a Mismatch.
5. **Imperfect photos** (Jenny). The app corrects EXIF orientation, resizes the
   image to a good size for OCR, and applies grayscale plus contrast stretching to
   even out dim or glare-affected photos. The sample set includes a tilted phone
   photo with glare, and it still reads correctly.
6. **Simple UI** (Sarah's "my mother could use it" test). Numbered steps 1-2-3, one
   large primary button, 19px base text, high contrast, plain-language results,
   keyboard and screen-reader friendly, no hidden menus.
7. **Batch uploads** (Janet in Seattle). Images are matched to CSV rows by file name.
   Images with no CSV row, and CSV rows with no image, are both reported, so
   nothing is silently dropped. Problems sort to the top.

### Tools
- Vanilla JavaScript and [Vite](https://vitejs.dev/). There is no framework: the UI is
  two screens, and plain JS keeps the bundle at 45 KB.
- Tesseract.js 7 (LSTM engine, `eng` "best_int" model, ~3 MB)
- Vitest for unit tests; sharp and Tesseract in Node for end-to-end tests; Playwright for a headless browser check
- Python + Pillow to generate test labels (`scripts/make_samples.py`)

## Run it locally

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the matching rules (24 tests)
npm run e2e        # real OCR + checks on every sample label, with timings
npm run build      # production build in dist/ (static files, host anywhere)
```

`npm run samples` regenerates the sample labels (needs Python 3 + Pillow).

The build is a folder of static files, so it can be hosted on any web server,
including inside an Azure tenant, with no backend and no outbound access.

## Batch CSV format

One row per label. Column headers (download a template from the app):

```
filename,brand_name,class_type,alcohol_content,net_contents,bottler,country_of_origin
label-001.jpg,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45% Alc./Vol. (90 Proof),750 mL,"Old Tom Distillery, Bardstown, Kentucky",
```

Empty cells are skipped (not checked). `filename` matching is case-insensitive.

## Sample labels

`public/samples/` contains 9 generated labels, each a deliberate test case:

| File | Expected | Result |
|---|---|---|
| 01 Old Tom, clean | Match | Match |
| 02 Stone's Throw, brand case differs | Match (noted) | Match |
| 03 Wrong ABV (40% vs 45%) | Mismatch | Mismatch |
| 04 "Government Warning" in title case | Mismatch | Mismatch |
| 05 Warning reworded | Mismatch | Mismatch |
| 06 Warning heading not bold | Flag | Check by eye (bold ratio 1.14 vs ~1.5 for bold) |
| 07 Imported French wine, country of origin | Match | Match |
| 08 Beer: 12 fl oz on label, 355 mL on form | Match | Match |
| 09 Tilted phone photo with glare | Match / review | Check by eye (one word possibly misread) |

## Assumptions

- The agent types (or the CSV supplies) the application values; there is no COLA
  integration, per Marcus.
- The government warning is the standard 27 CFR 16.21 text, and `GOVERNMENT WARNING:`
  includes the colon.
- Labels are in English. Only one image is checked per label (front or back, whichever
  carries the information). For multi-panel labels, combine the panels into one image.
- Fields left blank are not checked. Brand name is the only required field.

## Limitations and trade-offs

- **Bold detection is a heuristic.** It compares the stroke thickness of the
  heading with the text that follows. If it can't measure, or the heading doesn't
  look bold, the result is *Check by eye*, never an automatic rejection.
- **Type size is not checked.** The regulations set minimum type sizes, and this
  requires knowing the container size and the physical scale of the image.
- **Beverage-specific rules are not implemented** (e.g. which wines may omit
  ABV, sulfite declarations, appellation rules). The checks cover the common
  elements from the brief.
- **OCR limits:** very stylized script fonts, curved text on round bottles, and
  heavy glare can defeat Tesseract. The app reports *not found* / *Check by eye*
  in those cases instead of guessing. A larger vision model would read better,
  but it would need a cloud endpoint (blocked by the firewall) or a GPU server.
  This is the main thing to revisit for production, for example an
  Azure-hosted model inside the FedRAMP boundary.
- **Perspective is not corrected.** Small tilts are fine. Strongly angled photos
  may need a retake.
- The sample labels are synthetic. Real COLA label images should be tested before
  any procurement decision.
- Batch mode keeps everything in browser memory. A batch of several hundred
  phone photos is fine on a normal workstation. Very large batches should be split up.

## Project layout

```
index.html              page structure
src/main.js             UI wiring: single + batch flows, CSV import/export
src/ocr.js              browser OCR: image prep, worker pool, two-pass read
src/ui/render.js        result rendering
src/lib/                pure logic, no DOM (unit-tested)
  verify.js             runs all checks, rolls up overall result
  fields.js             brand/text, alcohol, net contents rules
  warning.js            government warning: locate, caps, colon, bold, word diff
  bold.js               stroke-width measurement for bold detection
  text.js               normalization, fuzzy matching
  preprocess.js         grayscale + contrast stretch, sizing
  csv.js                CSV parse/write
scripts/                asset copy, sample generator, end-to-end runner
tests/                  unit tests
public/samples/         sample labels + example batch CSV
```
