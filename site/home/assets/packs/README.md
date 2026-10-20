# Official packs

Drop deck / folder / collection exports (`*.json`) in this directory and they
show up on the hidden `/packs/` page (Add to Decks / Download).

Accepted shapes (anything the app can already import):
- stamped scima envelopes (`{"$schema":"scima", …, "kind":"deck"|"folder"|"cards"}`)
- legacy version-2 exports (`{"version":2, "deck":…}` / `{"version":2, "folder":…, "decks":[…]}`)
- bare decks (`{"name":…, "cards":[…]}`) or collections (`{"decks":[…], "folders":[…]}`)

With the backend running, `/api/v1/packs` lists this directory automatically.
For static-only hosting, keep `manifest.json` in sync (array or `{"packs":[…]}`
of `{file, name, description}`) — it is the fallback the page reads.
`manifest.json` itself is never listed as a pack.
