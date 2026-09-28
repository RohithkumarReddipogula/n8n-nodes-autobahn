import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

const BASE_URL = 'https://verkehr.autobahn.de/o/autobahn';

/**
 * Maps each event type to the service path of the Autobahn API
 * and to the key that holds the list in the response body.
 */
const EVENT_TYPES: Record<string, { path: string; listKey: string; label: string }> = {
	roadworks: { path: 'roadworks', listKey: 'roadworks', label: 'Roadwork' },
	warning: { path: 'warning', listKey: 'warning', label: 'Warning' },
	closure: { path: 'closure', listKey: 'closure', label: 'Closure' },
	chargingStation: {
		path: 'electric_charging_station',
		listKey: 'electric_charging_station',
		label: 'Charging Station',
	},
	lorryParking: { path: 'parking_lorry', listKey: 'parking_lorry', label: 'Lorry Parking' },
	webcam: { path: 'webcam', listKey: 'webcam', label: 'Webcam' },
};

/** Normalise user input like "a1, A 100 ,a10" into ["A1", "A100", "A10"]. */
export function parseRoadIds(input: string): string[] {
	return input
		.split(',')
		.map((road) => road.replace(/\s+/g, '').toUpperCase())
		.filter((road) => road.length > 0);
}

/**
 * Turn a raw Autobahn event into a flat, predictable object.
 * The raw API returns strings for booleans, description lines as an array
 * and coordinates as strings, which is awkward for downstream nodes and LLMs.
 */
export function simplifyEvent(raw: IDataObject, roadId: string, eventType: string): IDataObject {
	const coordinate = (raw.coordinate as IDataObject | undefined) ?? {};
	const description = Array.isArray(raw.description)
		? (raw.description as string[]).map((line) => line.trim()).filter((line) => line !== '')
		: [];
	const lat = parseFloat(String(coordinate.lat ?? ''));
	const long = parseFloat(String(coordinate.long ?? ''));

	return {
		id: raw.identifier ?? null,
		road: roadId === '' ? null : roadId,
		type: EVENT_TYPES[eventType]?.label ?? eventType,
		title: typeof raw.title === 'string' ? raw.title.trim() : null,
		subtitle: typeof raw.subtitle === 'string' ? raw.subtitle.trim() : null,
		summary: description.join(' | '),
		isBlocked: String(raw.isBlocked) === 'true',
		isFuture: raw.future === true,
		startTime: raw.startTimestamp ?? null,
		latitude: Number.isNaN(lat) ? null : lat,
		longitude: Number.isNaN(long) ? null : long,
		mapUrl:
			Number.isNaN(lat) || Number.isNaN(long)
				? null
				: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}#map=14/${lat}/${long}`,
	};
}

export class Autobahn implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autobahn',
		name: 'autobahn',
		icon: { light: 'file:autobahn.svg', dark: 'file:autobahn.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Get live roadworks, warnings, closures, charging stations, lorry parking and webcams on German Autobahns',
		defaults: {
			name: 'Autobahn',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Road', value: 'road' },
					{ name: 'Traffic Event', value: 'event' },
				],
				default: 'event',
			},

			// ---------------- Road ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['road'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many roads',
						description: 'List many Autobahn road IDs covered by the API',
					},
				],
				default: 'getAll',
			},

			// ---------------- Traffic Event ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a traffic event',
						description: 'Get full details of a single event by its ID',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many traffic events',
						description: 'Get many events of one type on one or more roads',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Event Type',
				name: 'eventType',
				type: 'options',
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{ name: 'Charging Station', value: 'chargingStation' },
					{ name: 'Closure', value: 'closure' },
					{ name: 'Lorry Parking', value: 'lorryParking' },
					{ name: 'Roadwork', value: 'roadworks' },
					{ name: 'Warning', value: 'warning' },
					{ name: 'Webcam', value: 'webcam' },
				],
				default: 'roadworks',
				description: 'The kind of traffic event to fetch',
			},
			{
				displayName: 'Roads',
				name: 'roads',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
				default: 'A100',
				placeholder: 'A2, A9, A100',
				description: 'Comma-separated list of Autobahn IDs, for example A2, A9, A100',
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['event'], operation: ['get'] } },
				default: '',
				description: 'The ID of the event, as returned in the "ID" field of Get Many',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
				default: true,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: { resource: ['event'], operation: ['getAll'], returnAll: [false] },
				},
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				displayOptions: { show: { resource: ['event'] } },
				default: true,
				description:
					'Whether to return a clean, flat version of each event instead of the raw API response',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
				default: {},
				options: [
					{
						displayName: 'Only Blocked',
						name: 'onlyBlocked',
						type: 'boolean',
						default: false,
						description: 'Whether to return only events where lanes or the road are blocked',
					},
					{
						displayName: 'Exclude Future Events',
						name: 'excludeFuture',
						type: 'boolean',
						default: true,
						description: 'Whether to leave out events that have not started yet',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const request = async (url: string): Promise<IDataObject> => {
			try {
				return (await this.helpers.httpRequest({
					method: 'GET',
					url,
					headers: { Accept: 'application/json' },
					json: true,
				})) as IDataObject;
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'road' && operation === 'getAll') {
					const response = await request(`${BASE_URL}/`);
					const roads = (response.roads as string[] | undefined) ?? [];
					for (const road of roads) {
						returnData.push({ json: { road: road.trim() }, pairedItem: { item: i } });
					}
					continue;
				}

				const eventType = this.getNodeParameter('eventType', i) as string;
				const config = EVENT_TYPES[eventType];
				const simplify = this.getNodeParameter('simplify', i) as boolean;

				if (operation === 'get') {
					const eventId = (this.getNodeParameter('eventId', i) as string).trim();
					if (eventId === '') {
						throw new NodeOperationError(this.getNode(), 'Event ID must not be empty', {
							itemIndex: i,
						});
					}
					const response = await request(
						`${BASE_URL}/details/${config.path}/${encodeURIComponent(eventId)}`,
					);
					const json = simplify ? simplifyEvent(response, '', eventType) : response;
					returnData.push({ json, pairedItem: { item: i } });
					continue;
				}

				// Get Many
				const roads = parseRoadIds(this.getNodeParameter('roads', i) as string);
				if (roads.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Enter at least one road, for example A100', {
						itemIndex: i,
					});
				}
				const returnAll = this.getNodeParameter('returnAll', i) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
				const options = this.getNodeParameter('options', i, {}) as {
					onlyBlocked?: boolean;
					excludeFuture?: boolean;
				};
				const excludeFuture = options.excludeFuture ?? true;

				let count = 0;
				for (const road of roads) {
					if (count >= limit) break;
					const response = await request(
						`${BASE_URL}/${encodeURIComponent(road)}/services/${config.path}`,
					);
					const events = (response[config.listKey] as IDataObject[] | undefined) ?? [];

					for (const event of events) {
						if (count >= limit) break;
						if (excludeFuture && event.future === true) continue;
						if (options.onlyBlocked && String(event.isBlocked) !== 'true') continue;

						const json = simplify ? simplifyEvent(event, road, eventType) : { road, ...event };
						returnData.push({ json, pairedItem: { item: i } });
						count++;
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
