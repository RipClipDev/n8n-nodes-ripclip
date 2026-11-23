# n8n-nodes-ripclip

This is an n8n community node. It lets you use RipClip in your n8n workflows.

[RipClip](https://ripclip.org) turns long streams and videos into captioned vertical clips, and lets you edit them,
post them and track how they do. With this node a workflow can import a video, find its best clips, fetch a download
link and save a post as a draft, and it can start when a new clip is ready or a job finishes.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation. The package name is `n8n-nodes-ripclip`.

## Operations

### RipClip Trigger

The trigger checks RipClip on the schedule you set under **Poll Times**.

| Event | Starts the workflow when | Each item is |
| --- | --- | --- |
| **New Clip** | a clip is added to your RipClip Library | the clip: `clip_id`, `title`, start, end and duration in seconds, `download_url` (works for 5 minutes), `editor_url`, `created_at` |
| **Job Finished** | an import or a clip job ends, done or failed | the job: `job_id`, `status` (`done` or `failed`), `kind`, `name`, `project_id`, `created_at`, `finished_at` |

**Job Finished** has a **Job Kind** filter: Any, Find Clips, Import Video or Find Moments.

Turning a workflow on never replays old clips or jobs: the first check only remembers what is already there. A test
run in the editor shows the newest clip or job as a sample.

### RipClip

| Resource | Operation | What it does |
| --- | --- | --- |
| Video | **Import** | Imports a video from a link into your account. Returns a `job_id`; importing costs no Horizon Units. |
| Clip | **Find** | Finds the best moments in an imported video and turns them into captioned vertical clips. Returns a `job_id`. |
| Clip | **Combine** | Joins 2 to 20 of your clips, in the order given, into one new clip in your Library. Returns a `job_id`; costs no Horizon Units. |
| Clip | **Get Download Link** | Returns a clip with a fresh download link (5 minutes). |
| Post | **Create Draft** | Saves a post for a clip as a draft. Nothing is scheduled or published until you do it in RipClip. |
| Job | **Get** | Returns a job's status and, once it is done, its clips (or the video an import made). |

**Import** takes a Kick or Twitch link, an Apple Podcasts episode, a Google Drive, Dropbox or OneDrive share link, or a
direct link to a video file. Turn on **I Have the Rights to This Video**: RipClip only imports a video you own or have
permission to use. To import and clip in one step, set **Also Find Clips: Max HU** (the most HU to spend, about 1 HU a
minute of video; 0 imports only) and the number of clips. When the import is done, **Get Job** on its `job_id` starts
the clips and returns the clip job as `next_job_id`; get that job for the clips. This needs a key with the generate
permission.

**Combine** takes the clip IDs (separated by commas or new lines, in play order), an optional shape and an optional
title. Poll **Get Job** until it is done; the new clip is then the newest one in your account (the RipClip Trigger's
New Clip fires for it).

**Find** spends Horizon Units (HU), RipClip's processing credits. **Max HU** is the most one run may spend:
RipClip quotes the video first, and the node stops with the quoted number if it is above your limit. Options: number of
clips (0 lets RipClip decide), shortest and longest clip, a prompt for what to look for, and a time range.

**Create Draft** takes a clip, a platform (TikTok, YouTube Shorts, Instagram Reels, Facebook Reels, Threads or Bluesky),
a caption and an optional time. The output has a `review_url` that opens the draft in RipClip.

The RipClip node can also be used as a tool by an n8n AI Agent.

## Credentials

You need a RipClip account ([sign up free](https://ripclip.org)). Finding clips with the API needs Horizon Units on
your plan.

1. In RipClip, open **Account > Connect to AI**.
2. In the key form, enter a **Key name** (for example "n8n") and a **Monthly HU limit**, and keep all four
   **Permissions** ticked: read, import, generate, and edit clips and save post drafts.
3. Select **Create key** and copy the key. RipClip shows it once.
4. In n8n, create a **RipClip API** credential and paste the key.

A key works for 90 days. When it ends, create a new key and paste it into the same credential. You can revoke a key on
the same RipClip page at any time.

## Compatibility

Built with the n8n node CLI for n8n 1.x (nodes API version 1). The request code is tested against RipClip's API on
Node.js 24. No runtime dependencies.

## Usage

**Clip every new video.** RipClip Trigger (Job Finished, Job Kind: Import Video) → IF `status` is `done` → RipClip
(Clip: Find, Video: `{{ $json.project_id }}`, Max HU: your limit).

**Send every new clip somewhere.** RipClip Trigger (New Clip) → HTTP Request (GET `{{ $json.download_url }}`, response
format File) → Google Drive, Dropbox, Slack or Discord. The download link works for 5 minutes, so download it in the
same run. For an older clip, use **Get Download Link** first.

**Draft a post for every new clip.** RipClip Trigger (New Clip) → RipClip (Post: Create Draft, Clip:
`{{ $json.clip_id }}`, Platform: TikTok, Caption: `{{ $json.title }}`). Open RipClip to check and schedule the drafts.

**Import from a link, then wait for the clips.** RipClip (Video: Import) → Wait → RipClip (Job: Get, Job ID:
`{{ $json.job_id }}`) → IF `status` is `done`, else loop back to Wait.

Times in the output are ISO 8601 in UTC. An error from RipClip shows its own message, for example "This video needs
14.2 HU and Max HU is 10."

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [RipClip](https://ripclip.org) and its [support page](https://ripclip.org/support)
- Questions about this node: support@ripclip.org

The code is MIT licensed. The RipClip name and logo are trademarks of RipClip and are not covered by that licence.

## Version history

- **0.2.0**: Import can also clip the video (Also Find Clips: Max HU; Get Job shows `next_job_id`), and a new Clip
  operation, Combine, joins clips into one video.
- **0.1.1**: the same code as 0.1.0, published from GitHub Actions with npm provenance.
- **0.1.0**: first release. RipClip Trigger (New Clip, Job Finished) and RipClip (Import, Find, Get Download
  Link, Create Draft, Get Job).
