// The node's request code (nodes/RipClip/api.ts) against a real RipClip server. Node 24+ runs the TypeScript directly.
// `npm test` alone runs the trigger-memory test; the rest needs a RipClip server: set RIPCLIP_TEST_BASE and
// RIPCLIP_TEST_KEY (an API key from a test account) to run them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	RipClipError,
	combineClips,
	draftPost,
	findClips,
	fresh,
	getClip,
	getJob,
	importVideo,
	listClips,
	listFinishedJobs,
	listProjects,
} from '../nodes/RipClip/api.ts';

const { RIPCLIP_TEST_BASE: BASE, RIPCLIP_TEST_KEY: KEY } = process.env;
const PROJECT = process.env.RIPCLIP_TEST_PROJECT;
const CLIP = process.env.RIPCLIP_TEST_CLIP;
const live = { skip: !BASE || !KEY ? 'no test server (set RIPCLIP_TEST_BASE and RIPCLIP_TEST_KEY)' : false };

// What transport.ts does in n8n: one request with the credential, the status returned and not thrown.
const sender = (key) => async ({ method, path, qs, body, headers }) => {
	const url = new URL(BASE + '/api/v1' + path);
	for (const [k, v] of Object.entries(qs ?? {})) url.searchParams.set(k, String(v));
	const response = await fetch(url, {
		method,
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : null };
};
const send = sender(KEY);

async function finished(jobId) {
	for (let i = 0; i < 100; i++) {
		const job = await getJob(send, jobId);
		if (job.status === 'done' || job.status === 'failed') return job;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`job ${jobId} did not finish`);
}

const refused = (code, status) => (error) =>
	error instanceof RipClipError && error.code === code && error.status === status;

test('Import with Max HU sends the clip fields, Combine sends 2 to 20 ids in order (no server needed)', async () => {
	const sent = [];
	const fake = async (request) => (sent.push(request), { status: 202, body: { job_id: 'j1' } });
	await importVideo(fake, 'https://media.example.com/a.mp4', true);
	await importVideo(fake, 'https://media.example.com/a.mp4', true, { maxHu: 0, count: 3 });
	await importVideo(fake, 'https://media.example.com/a.mp4', true, { maxHu: 12, count: 3 });
	assert.deepEqual(sent.map((r) => r.body), [
		{ url: 'https://media.example.com/a.mp4', rights: true },
		{ url: 'https://media.example.com/a.mp4', rights: true },
		{ url: 'https://media.example.com/a.mp4', rights: true, clip_max_hu: 12, clip_count: 3 },
	]);
	sent.length = 0;
	await combineClips(fake, 'a1, b2\nc3', '16:9', 'Week');
	await combineClips(fake, ['x', 'y']);
	assert.equal(sent[0].path, '/combinations');
	assert.deepEqual(sent[0].body, { clip_ids: ['a1', 'b2', 'c3'], shape: '16:9', title: 'Week' });
	assert.deepEqual(sent[1].body, { clip_ids: ['x', 'y'] });
	for (const bad of ['a1', '', Array.from({ length: 21 }, (_, i) => `c${i}`)]) {
		await assert.rejects(combineClips(fake, bad), refused('invalid_argument', 400));
	}
	assert.equal(sent.length, 2);
});

test('trigger memory: the first poll remembers, later polls emit only new rows, oldest first', () => {
	const rows = (...ids) => ids.map((id) => ({ id }));
	const first = fresh(rows('b', 'a'), undefined, 'id');
	assert.deepEqual(first, { emit: [], seen: ['b', 'a'] });
	const second = fresh(rows('d', 'c', 'b', 'a'), first.seen, 'id');
	assert.deepEqual(second.emit, rows('c', 'd'));
	assert.deepEqual(second.seen, ['d', 'c', 'b', 'a']);
	assert.deepEqual(fresh(rows('d', 'c'), second.seen, 'id').emit, []); // a row that left the list stays seen
	assert.deepEqual(fresh([], undefined, 'id'), { emit: [], seen: [] }); // an empty account: the next row is new
	assert.deepEqual(fresh(rows('a'), [], 'id').emit, rows('a'));
});

test('a wrong API key is refused with a readable message', live, async () => {
	await assert.rejects(listProjects(sender('rc_live_wrong_key')), (error) => {
		assert.equal(error.status, 401);
		assert.match(error.message, /key/i);
		return true;
	});
});

test('videos and clips load for the pick-lists', live, async () => {
	const projects = await listProjects(send);
	assert.ok(projects.some((p) => p.project_id === PROJECT && p.name === 'Test stream'));
	const clips = await listClips(send);
	assert.equal(clips[0].clip_id, CLIP);
	assert.match(clips[0].created_at, /^\d{4}-\d\d-\d\dT/); // ISO dates for n8n
});

test('Import Video needs the rights box, then a finished import names its video', live, async () => {
	await assert.rejects(importVideo(send, 'https://media.example.com/stream.mp4', false), refused('rights_required', 400));
	const accepted = await importVideo(send, 'https://media.example.com/stream.mp4', true);
	assert.equal(accepted.status, 'queued');
	const job = await finished(accepted.job_id);
	assert.equal(job.status, 'done');
	assert.equal(job.kind, 'import_url');
	assert.equal(job.project_id, PROJECT);
	assert.deepEqual(job.clips, []);
	await assert.rejects(importVideo(send, 'not a link at all', true), (error) => error.status === 400 || error.status === 422);
});

test('Find Clips stops above Max HU, and a finished job has its clips; Job Finished fires once', live, async () => {
	let memory = fresh(await listFinishedJobs(send, 'generate'), undefined, 'job_id');
	assert.deepEqual(memory.emit, []);

	await assert.rejects(findClips(send, { projectId: PROJECT, maxHu: 0 }), (error) => {
		assert.ok(refused('budget_exceeded', 402)(error));
		assert.match(error.message, /needs [\d.]+ HU and Max HU is 0/);
		return true;
	});
	await assert.rejects(findClips(send, { projectId: 'nope', maxHu: 50 }), (error) => error.status === 404);

	const accepted = await findClips(send, { projectId: PROJECT, maxHu: 50, count: 1, minSeconds: 20, maxSeconds: 45, prompt: 'funny' });
	assert.ok(accepted.estimated_hu > 0 && accepted.reserved_hu <= 50);
	const job = await finished(accepted.job_id);
	assert.equal(job.status, 'done');
	assert.equal(job.clip_count, 1);
	assert.equal(job.clips[0].clip_id, CLIP);
	assert.match(job.finished_at, /^\d{4}-\d\d-\d\dT/);

	memory = fresh(await listFinishedJobs(send, 'generate'), memory.seen, 'job_id');
	assert.deepEqual(memory.emit.map((j) => j.job_id), [accepted.job_id]);
	memory = fresh(await listFinishedJobs(send, 'generate'), memory.seen, 'job_id');
	assert.deepEqual(memory.emit, []);
});

test('Job Finished reports a failed job too', live, async () => {
	const before = fresh(await listFinishedJobs(send), undefined, 'job_id');
	const accepted = await importVideo(send, 'https://media.example.com/fail.mp4', true);
	const job = await finished(accepted.job_id);
	assert.equal(job.status, 'failed');
	const after = fresh(await listFinishedJobs(send), before.seen, 'job_id');
	assert.deepEqual(after.emit.map((j) => [j.job_id, j.status, j.error]), [[accepted.job_id, 'failed', 'processing_failed']]);
	assert.match(after.emit[0].finished_at, /^\d{4}-\d\d-\d\dT/);
});

test('Get Download Link gives a link that downloads the clip', live, async () => {
	const clip = await getClip(send, CLIP);
	assert.equal(clip.title, 'Best moment');
	const link = new URL(clip.download_url);
	const file = await fetch(BASE + link.pathname + link.search); // the link names the public site; ask this server
	assert.equal(await file.text(), 'clip');
	await assert.rejects(getClip(send, 'nope'), refused('not_found', 404));
});

test('Draft Post saves a draft and never schedules it', live, async () => {
	const draft = await draftPost(send, { clipId: CLIP, platform: 'youtube', caption: 'Watch this', scheduledAt: '2026-12-01T18:00:00' });
	assert.equal(draft.status, 'draft');
	assert.equal(draft.platform, 'youtube');
	assert.match(draft.review_url, /#post\//);
	assert.match(draft.scheduled_at, /^2026-12-0[12]T/);
	const bare = await draftPost(send, { clipId: CLIP, platform: 'tiktok' });
	assert.equal(bare.scheduled_at, null);
	await assert.rejects(draftPost(send, { clipId: CLIP, platform: 'myspace' }), (error) => error.status === 400 && /Use one of/.test(error.message));
	await assert.rejects(draftPost(send, { clipId: 'nope', platform: 'tiktok' }), (error) => error.status === 404);
	await assert.rejects(draftPost(send, { clipId: CLIP, platform: 'tiktok', scheduledAt: 'soon' }), refused('invalid_argument', 400));
});
