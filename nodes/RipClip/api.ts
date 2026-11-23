// RipClip's REST API (https://ripclip.org/api/v1) for the two nodes. No n8n imports here: every function takes a
// `Send` that performs one HTTP request, so the same code runs in n8n and in test/api.test.mjs against a real server.

export type Json = Record<string, unknown>;

export interface ApiRequest {
	method: 'GET' | 'POST';
	path: string;
	qs?: Record<string, string | number>;
	body?: Json;
	headers?: Record<string, string>;
}

export interface ApiResponse {
	status: number;
	body: unknown;
}

export type Send = (request: ApiRequest) => Promise<ApiResponse>;

export class RipClipError extends Error {
	status: number;

	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'RipClipError';
		this.status = status;
		this.code = code;
	}
}

// RipClip dedupes a POST by its Idempotency-Key for 24 hours, so every new operation gets a new key.
export function requestKey(): string {
	return `n8n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// API errors are {error: {code, message}}; validation errors keep FastAPI's {detail} shape.
function failure(status: number, body: unknown): RipClipError {
	const data = (body ?? {}) as { error?: { code?: string; message?: string }; detail?: unknown };
	const first = Array.isArray(data.detail) ? (data.detail[0] as { msg?: string } | undefined) : undefined;
	const detail = typeof data.detail === 'string' ? data.detail : first?.msg;
	const message =
		data.error?.message ||
		detail ||
		(status === 401
			? 'RipClip did not accept the API key. Create a new key on Account > Connect to AI.'
			: `RipClip refused the request (${status}).`);
	return new RipClipError(status, data.error?.code || 'error', message);
}

async function call(send: Send, request: ApiRequest): Promise<Json> {
	const headers = request.method === 'POST' ? { 'Idempotency-Key': requestKey() } : undefined;
	const response = await send({ ...request, headers });
	if (response.status >= 400) throw failure(response.status, response.body);
	return (response.body ?? {}) as Json;
}

const iso = (seconds: unknown) =>
	typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;

function clip(row: Json): Json {
	return {
		...row,
		created_at: iso(row.created_at),
		download_expires_at: iso(row.download_expires_at),
	};
}

function job(row: Json): Json {
	return { ...row, created_at: iso(row.created_at), finished_at: iso(row.finished_at) };
}

export interface ClipAfterImport {
	maxHu: number;
	count?: number;
}

// With `clip`, RipClip also clips the video once it is imported (at most maxHu): Get Job on the import then shows
// next_job_id, the clip job.
export async function importVideo(
	send: Send,
	url: string,
	rights: boolean,
	clip?: ClipAfterImport,
): Promise<Json> {
	if (!rights) {
		throw new RipClipError(
			400,
			'rights_required',
			'Confirm you own the video or have permission to use it.',
		);
	}
	const body: Json = { url, rights: true };
	if (clip && clip.maxHu > 0) {
		body.clip_max_hu = clip.maxHu;
		if (clip.count !== undefined) body.clip_count = clip.count;
	}
	return await call(send, { method: 'POST', path: '/imports', body });
}

// Joins 2 to 20 clips (ids as a list, or one comma or line separated string) into one new clip, in that order.
export async function combineClips(
	send: Send,
	clipIds: string | string[],
	shape = '',
	title = '',
): Promise<Json> {
	const ids = (Array.isArray(clipIds) ? clipIds : clipIds.split(/[\s,]+/)).map((id) => id.trim());
	const clean = ids.filter(Boolean);
	if (clean.length < 2 || clean.length > 20) {
		throw new RipClipError(400, 'invalid_argument', 'Give 2 to 20 clip IDs to join.');
	}
	const body: Json = { clip_ids: clean };
	if (shape) body.shape = shape;
	if (title) body.title = title;
	return await call(send, { method: 'POST', path: '/combinations', body });
}

export interface FindClipsInput {
	projectId: string;
	maxHu: number;
	count?: number;
	minSeconds?: number;
	maxSeconds?: number;
	prompt?: string;
	rangeStart?: number;
	rangeEnd?: number;
}

// Quotes the video first and stops when it costs more than Max HU, so the error names the number to approve.
export async function findClips(send: Send, input: FindClipsInput): Promise<Json> {
	const range = { range_start: input.rangeStart ?? 0, range_end: input.rangeEnd ?? 0 };
	const estimate = await call(send, {
		method: 'POST',
		path: '/estimates',
		body: { project_id: input.projectId, ...range },
	});
	const hu = Number(estimate.hu);
	if (hu > input.maxHu + 1e-9) {
		throw new RipClipError(
			402,
			'budget_exceeded',
			`This video needs ${hu} HU and Max HU is ${input.maxHu}. Raise Max HU to at least ${hu}.`,
		);
	}
	const body: Json = { project_id: input.projectId, max_hu: input.maxHu, ...range };
	if (input.count !== undefined) body.count = input.count;
	if (input.minSeconds !== undefined) body.min_seconds = input.minSeconds;
	if (input.maxSeconds !== undefined) body.max_seconds = input.maxSeconds;
	if (input.prompt) body.prompt = input.prompt;
	const accepted = await call(send, { method: 'POST', path: '/generations', body });
	return { ...accepted, estimated_hu: hu };
}

// A job and, once it is done, what it made: the clips of a clip job or the video of an import.
export async function getJob(send: Send, jobId: string): Promise<Json> {
	const found = job(await call(send, { method: 'GET', path: `/jobs/${encodeURIComponent(jobId)}` }));
	if (found.status !== 'done') return { ...found, clips: [], clip_count: 0 };
	const results = await call(send, { method: 'GET', path: `/results/${found.job_id}` });
	const clips = ((results.clips as Json[]) ?? []).map(clip);
	return {
		...found,
		project_id: results.project_id ?? found.project_id,
		clips,
		clip_count: clips.length,
	};
}

export async function getClip(send: Send, clipId: string): Promise<Json> {
	return clip(await call(send, { method: 'GET', path: `/clips/${encodeURIComponent(clipId)}` }));
}

export interface DraftPostInput {
	clipId: string;
	platform: string;
	caption?: string;
	scheduledAt?: string;
}

// Saves a draft only. Nothing is scheduled or published until the user does it in RipClip.
export async function draftPost(send: Send, input: DraftPostInput): Promise<Json> {
	const body: Json = { clip_id: input.clipId, platform: input.platform };
	if (input.caption) body.caption = input.caption;
	if (input.scheduledAt) {
		const when = new Date(input.scheduledAt);
		if (Number.isNaN(when.getTime())) {
			throw new RipClipError(400, 'invalid_argument', 'Scheduled At is not a date and time.');
		}
		body.scheduled_at = when.toISOString();
	}
	return await call(send, { method: 'POST', path: '/posts', body });
}

export async function listClips(send: Send, limit = 100): Promise<Json[]> {
	const found = await call(send, { method: 'GET', path: '/clips', qs: { limit } });
	return ((found.clips as Json[]) ?? []).map(clip);
}

// Jobs that have ended, done or failed, newest first. kind: '' (any), 'generate', 'import_url' or 'find_moments'.
export async function listFinishedJobs(send: Send, kind = '', limit = 100): Promise<Json[]> {
	const qs: Record<string, string | number> = { limit };
	if (kind) qs.kind = kind;
	const found = await call(send, { method: 'GET', path: '/jobs', qs });
	return ((found.jobs as Json[]) ?? [])
		.filter((row) => row.status === 'done' || row.status === 'failed')
		.map(job);
}

export async function listProjects(send: Send, limit = 100): Promise<Json[]> {
	const found = await call(send, { method: 'GET', path: '/projects', qs: { limit } });
	return (found.projects as Json[]) ?? [];
}

// A polling trigger's memory: the rows not seen before, oldest first, and the ids to remember. The first poll
// (seen undefined) only remembers what exists, so turning a workflow on never replays old clips or jobs.
// The lists are the newest 100, so a job that ends after 100 newer jobs were made is not reported.
export function fresh(
	rows: Json[],
	seen: string[] | undefined,
	key: string,
): { emit: Json[]; seen: string[] } {
	const ids = rows.map((row) => String(row[key]));
	if (seen === undefined) return { emit: [], seen: ids };
	const known = new Set(seen);
	const emit = rows.filter((row) => !known.has(String(row[key]))).reverse();
	return { emit, seen: [...ids, ...seen.filter((id) => !ids.includes(id))].slice(0, 500) };
}
