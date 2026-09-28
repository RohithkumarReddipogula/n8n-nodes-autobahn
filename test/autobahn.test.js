// Tests run against the compiled node in dist/, with the HTTP layer mocked.
// Fixtures follow the real response shape of https://verkehr.autobahn.de/o/autobahn
const test = require('node:test');
const assert = require('node:assert/strict');
const { Autobahn, parseRoadIds, simplifyEvent } = require('../dist/nodes/Autobahn/Autobahn.node.js');

const BASE = 'https://verkehr.autobahn.de/o/autobahn';

const roadwork = (id, overrides = {}) => ({
	identifier: id,
	icon: 'warnkegel',
	isBlocked: 'false',
	future: false,
	extent: '52.5,13.3,52.6,13.4',
	point: '52.5,13.3',
	display_type: 'SHORT_TERM_ROADWORKS',
	subtitle: ' Dreieck Funkturm -> Kreuz Schöneberg',
	title: 'A100 | Kaiserdamm - Messedamm ',
	coordinate: { lat: '52.507', long: '13.283' },
	description: ['Beginn: 01.10.26 um 07:00 Uhr', 'Ende: 03.10.26 um 18:00 Uhr', '', 'Fahrbahnverengung'],
	routeRecommendation: [],
	footer: [],
	...overrides,
});

const FIXTURES = {
	[`${BASE}/`]: { roads: ['A1', 'A100 ', 'A2'] },
	[`${BASE}/A100/services/roadworks`]: {
		roadworks: [
			roadwork('rw-1'),
			roadwork('rw-2', { isBlocked: 'true' }),
			roadwork('rw-3', { future: true }),
		],
	},
	[`${BASE}/A2/services/roadworks`]: {
		roadworks: [roadwork('rw-4', { isBlocked: 'true', title: 'A2 | Brandenburg - Wollin' })],
	},
	[`${BASE}/A9/services/closure`]: { closure: [] },
	[`${BASE}/details/roadworks/rw-2`]: roadwork('rw-2', { isBlocked: 'true' }),
};

/** Minimal stand-in for n8n's IExecuteFunctions. */
function createContext(params, { items = [{ json: {} }], continueOnFail = false } = {}) {
	const requested = [];
	return {
		requested,
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'Autobahn', type: 'n8n-nodes-autobahn.autobahn', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: async ({ url }) => {
				requested.push(url);
				if (!(url in FIXTURES)) {
					const err = new Error(`404 Not Found: ${url}`);
					err.httpCode = '404';
					throw err;
				}
				return JSON.parse(JSON.stringify(FIXTURES[url]));
			},
		},
	};
}

const run = async (ctx) => {
	const node = new Autobahn();
	const [out] = await node.execute.call(ctx);
	return out;
};

test('parseRoadIds normalises messy input', () => {
	assert.deepEqual(parseRoadIds('a1, A 100 ,,a10 '), ['A1', 'A100', 'A10']);
	assert.deepEqual(parseRoadIds('  '), []);
});

test('simplifyEvent flattens the raw API shape', () => {
	const flat = simplifyEvent(roadwork('rw-1', { isBlocked: 'true' }), 'A100', 'roadworks');
	assert.equal(flat.id, 'rw-1');
	assert.equal(flat.road, 'A100');
	assert.equal(flat.type, 'Roadwork');
	assert.equal(flat.title, 'A100 | Kaiserdamm - Messedamm');
	assert.equal(flat.subtitle, 'Dreieck Funkturm -> Kreuz Schöneberg');
	assert.equal(flat.isBlocked, true);
	assert.equal(flat.latitude, 52.507);
	assert.equal(flat.longitude, 13.283);
	assert.equal(flat.summary, 'Beginn: 01.10.26 um 07:00 Uhr | Ende: 03.10.26 um 18:00 Uhr | Fahrbahnverengung');
	assert.match(flat.mapUrl, /openstreetmap\.org/);
});

test('Road > Get Many returns one item per road, trimmed', async () => {
	const out = await run(createContext({ resource: 'road', operation: 'getAll' }));
	assert.deepEqual(out.map((o) => o.json.road), ['A1', 'A100', 'A2']);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('Event > Get Many skips future events by default and covers several roads', async () => {
	const ctx = createContext({
		resource: 'event',
		operation: 'getAll',
		eventType: 'roadworks',
		roads: 'a100, A2',
		returnAll: true,
		simplify: true,
		options: {},
	});
	const out = await run(ctx);
	assert.deepEqual(out.map((o) => o.json.id), ['rw-1', 'rw-2', 'rw-4']);
	assert.deepEqual(ctx.requested, [`${BASE}/A100/services/roadworks`, `${BASE}/A2/services/roadworks`]);
});

test('Event > Get Many honours Only Blocked, Exclude Future = false and Limit', async () => {
	const blocked = await run(
		createContext({
			resource: 'event',
			operation: 'getAll',
			eventType: 'roadworks',
			roads: 'A100,A2',
			returnAll: true,
			simplify: true,
			options: { onlyBlocked: true },
		}),
	);
	assert.deepEqual(blocked.map((o) => o.json.id), ['rw-2', 'rw-4']);

	const limited = await run(
		createContext({
			resource: 'event',
			operation: 'getAll',
			eventType: 'roadworks',
			roads: 'A100,A2',
			returnAll: false,
			limit: 2,
			simplify: true,
			options: { excludeFuture: false },
		}),
	);
	assert.deepEqual(limited.map((o) => o.json.id), ['rw-1', 'rw-2']);
});

test('Event > Get Many with Simplify off returns the raw event plus the road', async () => {
	const out = await run(
		createContext({
			resource: 'event',
			operation: 'getAll',
			eventType: 'roadworks',
			roads: 'A2',
			returnAll: true,
			simplify: false,
			options: {},
		}),
	);
	assert.equal(out[0].json.road, 'A2');
	assert.equal(out[0].json.isBlocked, 'true');
	assert.ok(Array.isArray(out[0].json.description));
});

test('Event > Get fetches a single event by ID', async () => {
	const out = await run(
		createContext({ resource: 'event', operation: 'get', eventType: 'roadworks', eventId: ' rw-2 ', simplify: true }),
	);
	assert.equal(out.length, 1);
	assert.equal(out[0].json.id, 'rw-2');
	assert.equal(out[0].json.road, null);
	assert.equal(out[0].json.isBlocked, true);
});

test('Empty result sets return no items instead of failing', async () => {
	const out = await run(
		createContext({
			resource: 'event',
			operation: 'getAll',
			eventType: 'closure',
			roads: 'A9',
			returnAll: true,
			simplify: true,
			options: {},
		}),
	);
	assert.equal(out.length, 0);
});

test('Validation and API errors throw, or become items with Continue On Fail', async () => {
	await assert.rejects(
		run(createContext({ resource: 'event', operation: 'getAll', eventType: 'roadworks', roads: ' , ', returnAll: true, simplify: true, options: {} })),
		/at least one road/,
	);

	const params = { resource: 'event', operation: 'getAll', eventType: 'roadworks', roads: 'A999', returnAll: true, simplify: true, options: {} };
	await assert.rejects(run(createContext(params)));

	const out = await run(createContext(params, { continueOnFail: true }));
	assert.equal(out.length, 1);
	assert.ok(out[0].json.error);
});

test('Each input item is processed independently', async () => {
	const out = await run(
		createContext(
			{ resource: 'event', operation: 'getAll', eventType: 'roadworks', roads: 'A2', returnAll: true, simplify: true, options: {} },
			{ items: [{ json: {} }, { json: {} }] },
		),
	);
	assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1]);
});
