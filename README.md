# Cape George HOA GIS Prototype — Live County Parcel Query

This GitHub Pages prototype uses Leaflet. It now loads HOA member-lot polygons by querying Jefferson County's ArcGIS Online / Hub item for **Public Parcels StatePlane** using a local list of Cape George HOA parcel IDs.

## Files

- `index.html` — main web page
- `js/map.js` — map and live county query logic
- `css/style.css` — styling
- `data/hoa_parcel_ids.json` — the HOA parcel ID list used to query the county layer
- `data/HOA_Member_Lots.geojson` — static fallback copy, used if the live service cannot be reached
- `data/HOA_District_Boundary.geojson` — candidate HOA district boundary
- `data/HOA_Common_Areas.geojson` — common-area/context layer

## How the live query works

1. The app reads `data/hoa_parcel_ids.json`.
2. It uses the ArcGIS Online item ID `bac06906630646e08b9f4e7213e16a1e` to discover the county parcel service URL.
3. It queries the service in batches using the parcel ID field `PIN_STRING`.
4. It draws only the matching Cape George HOA member lots.
5. If the live query fails, it automatically falls back to `data/HOA_Member_Lots.geojson`.

## County assessor links

Parcel popups include:

- **Open county assessor record** — uses the parcel's `Prop_ID` and assessment year fields.
- **County property search** — opens the Jefferson County assessor search page.

## Updating the HOA membership list

Edit `data/hoa_parcel_ids.json` and add or remove parcel IDs from the `parcelIds` array. Keep IDs as strings with leading zeroes, for example:

```json
"001182012"
```

Then commit the change to GitHub.

## Publishing on GitHub Pages

1. Upload these files to the root of your GitHub repository.
2. Go to **Settings → Pages**.
3. Choose **Deploy from branch**.
4. Select `main` and `/root`.
5. Save.

