import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { RipClipError, type Send } from './api';

const BASE = 'https://ripclip.org/api/v1';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

// One request with the RipClip API credential. The status is returned, not thrown, so api.ts reads RipClip's
// own error message.
export function sender(context: Context): Send {
	return async ({ method, path, qs, body, headers }) => {
		const response = await context.helpers.httpRequestWithAuthentication.call(context, 'ripClipApi', {
			method,
			url: BASE + path,
			qs,
			body,
			headers,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
		return { status: response.statusCode, body: response.body };
	};
}

// RipClip's refusal as an n8n error that shows its message and HTTP status.
export function asNodeError(context: Context, error: unknown, itemIndex?: number): Error {
	if (!(error instanceof RipClipError)) return error as Error;
	return new NodeApiError(
		context.getNode(),
		{ message: error.message, code: error.code } as JsonObject,
		{ message: error.message, httpCode: String(error.status), itemIndex },
	);
}
