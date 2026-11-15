# COSMIC LENS

COSMIC LENS is a responsive React + Vite interface for exploring public SPHEREx archive records. It searches NASA/IPAC IRSA SIA v2 for live Data Release 1 metadata, converts supported FITS image products into in-app PNG views, compares matched same-band images, and uses NASA Images API imagery only as clearly labeled reference material. Tamil is the default language; English, Malayalam, Telugu, and Hindi are also supported and the selection persists in local storage.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm. Python 3.10+ is required for FITS-to-PNG conversion and image comparison.

```powershell
npm install
npm run dev
```

In a second terminal, start the FastAPI image processor:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The Vite development proxy sends FITS conversion and comparison requests to this API. IRSA search and byte-range FITS access are proxied directly by Vite. Create a production build with `npm run build`; preview frontend assets with `npm run preview`.

To serve the production build and same-origin IRSA proxy together, install Python 3.10+ and run:

```powershell
python -m pip install -r requirements.txt
npm run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

FastAPI serves the built `dist` directory, queries IRSA, and retrieves only products from official SPHEREx DR1 paths. It uses Astropy to extract valid celestial image planes, applies an asinh intensity stretch, and returns PNGs; original FITS data is a separate download. The comparison endpoint reprojects a same-band later image onto the earlier image's celestial WCS before exploratory source detection and matching.

## Production deployment

The repository includes Vercel static-site configuration (`vercel.json`) and a Render FastAPI blueprint (`render.yaml`). Deploy the frontend from the project root and set `VITE_API_BASE_URL` in Vercel to the Render service's HTTPS origin. Set `CORS_ORIGINS` in Render to the exact Vercel site origin (for example, `https://your-site.vercel.app`, without a trailing slash). The backend exposes `/health` for deployment health checks. Both API requests and FITS processing use the Render URL in production; leave `VITE_API_BASE_URL` unset for same-origin local development.

## Data sources

- [IRSA SPHEREx Data Release 1](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html) — spectral images and an all-sky cube covering 102 nominal channels.
- [IRSA SIA v2 documentation](https://irsa.ipac.caltech.edu/ibe/sia.html) — metadata search used by Sky Explorer (`COLLECTION=spherex_dr1`).
- [Official SPHEREx Data Explorer](https://irsa.ipac.caltech.edu/applications/spherex/) — archive image inspection and product visualization.
- [NASA Images API](https://images-api.nasa.gov/) — public reference imagery for education; reference images are not represented as SPHEREx observations.

Archive searches are requested on demand and successful metadata is cached in the browser for 15 minutes. No fixed observation totals or observation dates are presented as live data.

## Product and science limitations

The in-app viewer supports celestial 2D FITS image extensions and selectable non-spatial planes, with zoom, pan, reset, fullscreen, PNG download, and a separate original-FITS download. Static images are never treated as video. Unsupported product layouts are reported rather than reinterpreted.

The Time Machine requires two archive records in the same band, distinct observation times, matching units and compatible pixel scales, celestial WCS, and sufficient overlapping sky area. Source detection uses background/noise estimation and a local 5-sigma threshold; sources remain unclassified unless supported by a catalogue. Flux and positional changes are exploratory candidates, not calibrated discoveries. PSF homogenization, archive quality masks, absolute calibration uncertainty, and catalogue cross-identification are not applied. The spectrum page shows instrument wavelength coverage only when no measured spectrum is loaded. Reports do not claim changes when there is no processed comparison; PDF export uses the browser's Print / Save as PDF function.

## Citation

SPHEREx DR1 Spectral Images DOI: [10.26131/IRSA678](https://doi.org/10.26131/IRSA678). Follow the [IRSA acknowledgement and citation guidance](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html) when publishing work based on SPHEREx data.
