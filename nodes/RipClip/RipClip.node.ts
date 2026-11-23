import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	combineClips,
	draftPost,
	findClips,
	getClip,
	getJob,
	importVideo,
	listClips,
	listProjects,
	type Json,
} from './api';
import { asNodeError, sender } from './transport';

export class RipClip implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'RipClip',
		name: 'ripClip',
		icon: { light: 'file:ripclip.svg', dark: 'file:ripclip.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Import videos, find clips, get download links and draft posts with RipClip',
		defaults: {
			name: 'RipClip',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'ripClipApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Clip', value: 'clip' },
					{ name: 'Job', value: 'job' },
					{ name: 'Post', value: 'post' },
					{ name: 'Video', value: 'video' },
				],
				default: 'video',
			},

			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['video'] } },
				options: [
					{
						name: 'Import',
						value: 'import',
						description: 'Import a video from a link into your RipClip account',
						action: 'Import a video',
					},
				],
				default: 'import',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['clip'] } },
				options: [
					{
						name: 'Combine',
						value: 'combine',
						description: 'Join 2 to 20 of your clips into one new clip',
						action: 'Join clips into one video',
					},
					{
						name: 'Find',
						value: 'find',
						description:
							'Find the best moments in an imported video and turn them into captioned vertical clips',
						action: 'Find clips in a video',
					},
					{
						name: 'Get Download Link',
						value: 'getDownloadLink',
						description: 'Get a fresh download link for a clip',
						action: 'Get a download link for a clip',
					},
				],
				default: 'find',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post'] } },
				options: [
					{
						name: 'Create Draft',
						value: 'createDraft',
						description: 'Save a post for a clip as a draft to check and schedule in RipClip',
						action: 'Draft a post',
					},
				],
				default: 'createDraft',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['job'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the status of a job and, once it is done, its clips',
						action: 'Get a job',
					},
				],
				default: 'get',
			},

			// Video: Import
			{
				displayName: 'Video URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://kick.com/video/...',
				description:
					'A Kick or Twitch link, an Apple Podcasts episode, a Google Drive, Dropbox or OneDrive share link, or a direct link to a video file',
				displayOptions: { show: { resource: ['video'], operation: ['import'] } },
			},
			{
				displayName: 'I Have the Rights to This Video',
				name: 'rights',
				type: 'boolean',
				required: true,
				default: false,
				description: 'Whether you own this video or have permission to use it. RipClip only imports with this on.',
				displayOptions: { show: { resource: ['video'], operation: ['import'] } },
			},
			{
				displayName: 'Also Find Clips: Max HU',
				name: 'clipMaxHu',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 0,
				description:
					'The most Horizon Units to spend clipping the video as soon as it is imported (about 1 HU a minute). 0 imports only. Needs a key with the generate permission. Get Job on the import then shows next_job_id, the clip job.',
				displayOptions: { show: { resource: ['video'], operation: ['import'] } },
			},
			{
				displayName: 'Also Find Clips: Number of Clips',
				name: 'clipCount',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10 },
				default: 5,
				displayOptions: {
					show: { resource: ['video'], operation: ['import'] },
					hide: { clipMaxHu: [0] },
				},
			},

			// Clip: Combine
			{
				displayName: 'Clip IDs',
				name: 'clipIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'clip1, clip2, clip3',
				description:
					'2 to 20 clip IDs, separated by commas or new lines. They play in this order. Use the clip_id of earlier RipClip steps.',
				displayOptions: { show: { resource: ['clip'], operation: ['combine'] } },
			},
			{
				displayName: 'Shape',
				name: 'shape',
				type: 'options',
				default: '',
				description: "Leave empty to keep the first clip's shape",
				options: [
					{ name: 'Same as First Clip', value: '' },
					{ name: 'Landscape 16:9', value: '16:9' },
					{ name: 'Portrait 4:5', value: '4:5' },
					{ name: 'Square 1:1', value: '1:1' },
					{ name: 'Vertical 9:16', value: '9:16' },
				],
				displayOptions: { show: { resource: ['clip'], operation: ['combine'] } },
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: "The new clip's name in your Library. Empty gives it a default name.",
				displayOptions: { show: { resource: ['clip'], operation: ['combine'] } },
			},

			// Clip: Find Clips
			{
				displayName: 'Video Name or ID',
				name: 'projectId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getProjects' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['clip'], operation: ['find'] } },
			},
			{
				displayName: 'Max HU',
				name: 'maxHu',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				required: true,
				default: 10,
				description:
					'The most Horizon Units this run may spend. RipClip quotes the video first and stops if it costs more.',
				displayOptions: { show: { resource: ['clip'], operation: ['find'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['clip'], operation: ['find'] } },
				options: [
					{
						displayName: 'Longest Clip (Seconds)',
						name: 'maxSeconds',
						type: 'number',
						typeOptions: { minValue: 10, maxValue: 300 },
						default: 45,
					},
					{
						displayName: 'Number of Clips',
						name: 'count',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 10 },
						default: 5,
						description: 'How many clips to make. 0 lets RipClip decide.',
					},
					{
						displayName: 'Prompt',
						name: 'prompt',
						type: 'string',
						default: '',
						description: 'What to look for, in your own words (up to 500 characters)',
					},
					{
						displayName: 'Range End (Seconds)',
						name: 'rangeEnd',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description: 'Where in the video to stop looking. 0 means the end of the video.',
					},
					{
						displayName: 'Range Start (Seconds)',
						name: 'rangeStart',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description: 'Where in the video to start looking',
					},
					{
						displayName: 'Shortest Clip (Seconds)',
						name: 'minSeconds',
						type: 'number',
						typeOptions: { minValue: 5, maxValue: 180 },
						default: 20,
					},
				],
			},

			// Clip: Get Download Link, Post: Create Draft
			{
				displayName: 'Clip Name or ID',
				name: 'clipId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getClips' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: { resource: ['clip', 'post'], operation: ['getDownloadLink', 'createDraft'] },
				},
			},

			// Post: Create Draft
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				required: true,
				default: 'tiktok',
				options: [
					{ name: 'Bluesky', value: 'bluesky' },
					{ name: 'Facebook Reels', value: 'facebook' },
					{ name: 'Instagram Reels', value: 'instagram' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube Shorts', value: 'youtube' },
				],
				displayOptions: { show: { resource: ['post'], operation: ['createDraft'] } },
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'The text of the post, up to 2,200 characters',
				displayOptions: { show: { resource: ['post'], operation: ['createDraft'] } },
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description:
					'The time to suggest on the draft. The post stays a draft until you schedule it in RipClip.',
				displayOptions: { show: { resource: ['post'], operation: ['createDraft'] } },
			},

			// Job: Get
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				default: '',
				description: 'The job_id returned by Import or Find, or by the RipClip Trigger',
				displayOptions: { show: { resource: ['job'], operation: ['get'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const projects = await listProjects(sender(this));
					return projects.map((p) => ({
						name: `${p.name || 'Untitled video'} (${new Date(Number(p.updated_at) * 1000).toISOString().slice(0, 10)})`,
						value: String(p.project_id),
					}));
				} catch (error) {
					throw asNodeError(this, error);
				}
			},
			async getClips(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const clips = await listClips(sender(this));
					return clips.map((c) => ({
						name: `${c.title || 'Untitled clip'} (${String(c.created_at ?? '').slice(0, 10)})`,
						value: String(c.clip_id),
					}));
				} catch (error) {
					throw asNodeError(this, error);
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const send = sender(this);
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: Json;
				if (resource === 'video' && operation === 'import') {
					result = await importVideo(
						send,
						this.getNodeParameter('url', i) as string,
						this.getNodeParameter('rights', i) as boolean,
						{
							maxHu: this.getNodeParameter('clipMaxHu', i, 0) as number,
							count: this.getNodeParameter('clipCount', i, 5) as number,
						},
					);
				} else if (resource === 'clip' && operation === 'combine') {
					result = await combineClips(
						send,
						this.getNodeParameter('clipIds', i) as string,
						this.getNodeParameter('shape', i, '') as string,
						this.getNodeParameter('title', i, '') as string,
					);
				} else if (resource === 'clip' && operation === 'find') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					result = await findClips(send, {
						projectId: this.getNodeParameter('projectId', i) as string,
						maxHu: this.getNodeParameter('maxHu', i) as number,
						count: options.count as number | undefined,
						minSeconds: options.minSeconds as number | undefined,
						maxSeconds: options.maxSeconds as number | undefined,
						prompt: options.prompt as string | undefined,
						rangeStart: options.rangeStart as number | undefined,
						rangeEnd: options.rangeEnd as number | undefined,
					});
				} else if (resource === 'clip' && operation === 'getDownloadLink') {
					result = await getClip(send, this.getNodeParameter('clipId', i) as string);
				} else if (resource === 'post' && operation === 'createDraft') {
					result = await draftPost(send, {
						clipId: this.getNodeParameter('clipId', i) as string,
						platform: this.getNodeParameter('platform', i) as string,
						caption: this.getNodeParameter('caption', i, '') as string,
						scheduledAt: this.getNodeParameter('scheduledAt', i, '') as string,
					});
				} else {
					result = await getJob(send, this.getNodeParameter('jobId', i) as string);
				}
				out.push({ json: result as IDataObject, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw asNodeError(this, error, i);
			}
		}
		return [out];
	}
}
