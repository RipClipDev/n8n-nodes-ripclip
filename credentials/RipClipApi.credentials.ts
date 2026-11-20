import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RipClipApi implements ICredentialType {
	name = 'ripClipApi';

	displayName = 'RipClip API';

	icon: Icon = {
		light: 'file:../nodes/RipClip/ripclip.svg',
		dark: 'file:../nodes/RipClip/ripclip.svg',
	};

	documentationUrl = 'https://github.com/RipClipDev/n8n-nodes-ripclip#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'rc_live_...',
			description:
				'Create a key in RipClip on Account > Connect to AI. Keep all four permissions ticked. A key works for 90 days.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://ripclip.org/api/v1',
			url: '/me',
			method: 'GET',
		},
	};
}
