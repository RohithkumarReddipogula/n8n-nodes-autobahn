# n8n-nodes-autobahn

An n8n community node for the official German Autobahn API (verkehr.autobahn.de). It returns live roadworks, warnings, closures, charging stations, lorry parking and webcams for any Autobahn, in a clean format that is easy to use in workflows and by AI agents.

No API key is needed. The data comes from Die Autobahn GmbH des Bundes.

## Table of contents

1. Why this node exists
2. Installation
3. Operations
4. Options
5. Output format
6. Using it with the AI Agent node
7. Example workflow
8. Development
9. Compatibility
10. Resources

## 1. Why this node exists

The Autobahn API is public and useful, but awkward to work with directly. Booleans come back as strings ("true"), coordinates are strings, the description is an array of loose text lines, and every event type lives under a different key and URL. Calling it with the generic HTTP Request node means rebuilding the same clean-up logic in every workflow.

This node does that work once: pick an event type, list the roads, and get back flat, typed items that can go straight into an IF node, a spreadsheet, a Slack message or an LLM prompt.

## 2. Installation

In n8n (self-hosted or cloud with community nodes enabled):

1. Go to Settings > Community Nodes.
2. Click Install.
3. Enter `n8n-nodes-autobahn` and confirm.

See the n8n guide: https://docs.n8n.io/integrations/community-nodes/installation/

## 3. Operations

| Resource      | Operation | What it does                                                        |
|---------------|-----------|---------------------------------------------------------------------|
| Road          | Get Many  | Lists every Autobahn ID the API covers (A1, A2, ..., A999)          |
| Traffic Event | Get Many  | Returns all events of one type on one or more roads                  |
| Traffic Event | Get       | Returns the full details of one event by its ID                      |

Supported event types:

| Event type       | API service                 |
|------------------|-----------------------------|
| Roadwork         | roadworks                   |
| Warning          | warning                     |
| Closure          | closure                     |
| Charging Station | electric_charging_station   |
| Lorry Parking    | parking_lorry               |
| Webcam           | webcam                      |

## 4. Options

| Parameter             | Default | Description                                                          |
|-----------------------|---------|----------------------------------------------------------------------|
| Roads                 | A100    | Comma-separated road IDs. Input is normalised, so "a 9, A100" works  |
| Return All            | true    | Return every matching event, or stop at Limit                        |
| Limit                 | 50      | Maximum number of events when Return All is off                      |
| Simplify              | true    | Return flat, typed fields instead of the raw API response            |
| Only Blocked          | false   | Keep only events where lanes or the road are blocked                 |
| Exclude Future Events | true    | Leave out events that have not started yet                           |

## 5. Output format

With Simplify on, each event looks like this:

```json
{
  "id": "RVZfX1RSQUZGSUNfSVRFTV9fMTIzNDU=",
  "road": "A100",
  "type": "Roadwork",
  "title": "A100 | Kaiserdamm - Messedamm",
  "subtitle": "Dreieck Funkturm -> Kreuz Schoeneberg",
  "summary": "Beginn: 01.10.26 um 07:00 Uhr | Ende: 03.10.26 um 18:00 Uhr | Fahrbahnverengung",
  "isBlocked": false,
  "isFuture": false,
  "startTime": null,
  "latitude": 52.507,
  "longitude": 13.283,
  "mapUrl": "https://www.openstreetmap.org/?mlat=52.507&mlon=13.283#map=14/52.507/13.283"
}
```

With Simplify off, the raw API object is returned, with a `road` field added.

## 6. Using it with the AI Agent node

The node is marked as usable as a tool, so it can be attached to the AI Agent node. An agent can then answer questions such as "Are there any closures on the A9 right now?" or "Where can a truck park on the A2?" by calling the Autobahn API itself.

Tip: keep Simplify on when the node is used as a tool. The flat output uses far fewer tokens than the raw response and is easier for the model to reason about.

## 7. Example workflow

The folder `examples/` contains a ready-to-import workflow:

- `autobahn-daily-briefing.json`: every weekday morning, fetches blocked roadworks and closures on a list of roads, asks an LLM to write a short commuter briefing, and sends it by email.

Import it in n8n with Workflows > Import from File.

## 8. Development

Requirements: Node.js 20 or later.

```bash
git clone https://github.com/RohithkumarReddipogula/n8n-nodes-autobahn.git
cd n8n-nodes-autobahn
npm install
npm run build        # compile TypeScript into dist/
npm run lint         # official n8n community node linter
npm test             # build, then run the unit tests in test/
npm run dev          # start a local n8n with this node loaded
```

The tests mock the HTTP layer with fixtures that follow the real API response shape, so they run offline. They cover road listing, multi-road requests, filters, limits, raw and simplified output, single-event lookup, empty results, validation errors and Continue On Fail.

## 9. Compatibility

Built and tested with n8n-workflow 2.x and @n8n/node-cli 0.49. Node API version 1.

## 10. Resources

- Autobahn API documentation: https://autobahn.api.bund.dev/
- n8n community nodes: https://docs.n8n.io/integrations/community-nodes/
- Author: Rohith Kumar Reddipogula, https://rohithkumarreddipogula.github.io

License: MIT
