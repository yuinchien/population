# World Bank Data Explorer

A static data visualization web app using native JavaScript, CSS, SVG, and the World Bank Open Data API.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a GitHub repository and push these files to the default branch.
2. In GitHub, open **Settings > Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Select the default branch and `/root`, then save.

The app has no build step and can be hosted from the repository root.

## API

The app reads:

- `https://api.worldbank.org/v2/country?format=json&per_page=400`
- `https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}?format=json&date={start}:{end}&per_page=20000`

World Bank indicator codes can be found at <https://data.worldbank.org/indicator>.
