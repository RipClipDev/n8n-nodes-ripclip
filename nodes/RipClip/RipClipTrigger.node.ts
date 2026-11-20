import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { fresh, listClips, listFinishedJobs, type Json } from './api';
import { asNodeError, sender } from './transport';

export class RipClipTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'RipClip Trigger',
		name: 'ripClipTrigger',
		icon: { light: 'file:ripclip.svg', dark: 'file:ripclip.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when RipClip has a new clip or finishes a job',
		defaults: {
			name: 'RipClip Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'ripClipApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Job Finished',
						value: 'jobFinished',
						description: 'An import or a clip job ended, done or failed',
					},
					{
						name: 'New Clip',
						value: 'newClip',
						description: 'A clip was added to your RipClip Library',
					},
				],
				default: 'newClip',
			},
			{
				displayName: 'Job Kind',
				name: 'kind',
				type: 'options',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Find Clips', value: 'generate' },
					{ name: 'Find Moments', value: 'find_moments' },
					{ name: 'Import Video', value: 'import_url' },
				],
				default: '',
				description: 'Which jobs start the workflow',
				displayOptions: { show: { event: ['jobFinished'] } },
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const send = sender(this);
		let rows: Json[];
		let key: string;
		let memory: string;
		try {
			if (event === 'newClip') {
				rows = await listClips(send);
				key = 'clip_id';
				memory = 'clips';
			} else {
				const kind = this.getNodeParameter('kind', '') as string;
				rows = await listFinishedJobs(send, kind);
				key = 'job_id';
				memory = `jobs:${kind}`;
			}
		} catch (error) {
			throw asNodeError(this, error);
		}

		// A test run in the editor shows the newest row as a sample and remembers nothing.
		if (this.getMode() === 'manual') {
			return rows.length ? [this.helpers.returnJsonArray(rows.slice(0, 1) as IDataObject[])] : null;
		}

		const data = this.getWorkflowStaticData('node');
		const { emit, seen } = fresh(rows, data[memory] as string[] | undefined, key);
		data[memory] = seen;
		return emit.length ? [this.helpers.returnJsonArray(emit as IDataObject[])] : null;
	}
}
