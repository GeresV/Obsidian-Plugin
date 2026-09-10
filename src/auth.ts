import { requestUrl } from "obsidian";
import { AuthTokens, GRAPH_SCOPES, TodoSyncSettings } from "./types";

const AUTH_BASE = "https://login.microsoftonline.com";

export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
	message: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAuthTokens(body: any): AuthTokens {
	// 60s safety margin so we refresh a little before the token actually expires
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresAt: Date.now() + Math.max(0, (body.expires_in - 60)) * 1000,
	};
}

/** Step 1 of the OAuth device code flow: ask Microsoft for a code the user enters in a browser. No redirect URI needed, which is why this works on mobile. */
export async function startDeviceCodeFlow(clientId: string, tenant: string): Promise<DeviceCodeResponse> {
	const res = await requestUrl({
		url: `${AUTH_BASE}/${tenant}/oauth2/v2.0/devicecode`,
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		body: new URLSearchParams({ client_id: clientId, scope: GRAPH_SCOPES }).toString(),
		throw: false,
	});
	if (res.status !== 200) {
		throw new Error(
			`Gerätecode konnte nicht angefordert werden (HTTP ${res.status}): ${res.json?.error_description ?? res.text}`
		);
	}
	return res.json as DeviceCodeResponse;
}

/** Step 2: poll the token endpoint until the user has entered the code (or it expires / is cancelled). */
export async function pollDeviceCodeToken(
	clientId: string,
	tenant: string,
	deviceCode: string,
	intervalSeconds: number,
	expiresInSeconds: number,
	isCancelled: () => boolean
): Promise<AuthTokens> {
	const deadline = Date.now() + expiresInSeconds * 1000;
	let interval = Math.max(5, intervalSeconds);

	while (Date.now() < deadline) {
		if (isCancelled()) throw new Error("Anmeldung abgebrochen.");
		await sleep(interval * 1000);
		if (isCancelled()) throw new Error("Anmeldung abgebrochen.");

		let res;
		try {
			res = await requestUrl({
				url: `${AUTH_BASE}/${tenant}/oauth2/v2.0/token`,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					client_id: clientId,
					device_code: deviceCode,
				}).toString(),
				throw: false,
			});
		} catch {
			// A thrown error here (as opposed to a non-200 response, which we asked not to throw)
			// means the request never reached Microsoft at all - a transient connectivity hiccup,
			// e.g. mobile network throttling while the screen is off. Not worth aborting the whole
			// login over; just retry on the next tick like "authorization_pending" would.
			continue;
		}

		if (res.status === 200) {
			return toAuthTokens(res.json);
		}

		const error = res.json?.error;
		if (error === "authorization_pending") {
			continue;
		} else if (error === "slow_down") {
			interval += 5;
			continue;
		} else if (error === "authorization_declined") {
			throw new Error("Die Anmeldung wurde abgelehnt.");
		} else if (error === "expired_token") {
			throw new Error("Der Anmeldecode ist abgelaufen. Bitte erneut versuchen.");
		} else if (error === "invalid_grant" || error === "bad_verification_code") {
			continue;
		} else {
			throw new Error(`Anmeldung fehlgeschlagen: ${res.json?.error_description ?? res.status}`);
		}
	}
	throw new Error("Der Anmeldecode ist abgelaufen. Bitte erneut versuchen.");
}

export async function refreshAccessToken(clientId: string, tenant: string, refreshToken: string): Promise<AuthTokens> {
	const res = await requestUrl({
		url: `${AUTH_BASE}/${tenant}/oauth2/v2.0/token`,
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: refreshToken,
			scope: GRAPH_SCOPES,
		}).toString(),
		throw: false,
	});
	if (res.status !== 200) {
		throw new Error(
			`Sitzung konnte nicht erneuert werden (HTTP ${res.status}): ${res.json?.error_description ?? res.text}. Bitte in den Plugin-Einstellungen neu verbinden.`
		);
	}
	return toAuthTokens(res.json);
}

/** Returns a currently valid access token, refreshing it first if it has expired. */
export async function ensureValidAccessToken(
	settings: TodoSyncSettings,
	onTokensUpdated: (tokens: AuthTokens) => Promise<void>
): Promise<string> {
	if (!settings.auth) {
		throw new Error("Nicht mit Microsoft verbunden. Bitte zuerst in den Plugin-Einstellungen verbinden.");
	}
	if (Date.now() < settings.auth.expiresAt) {
		return settings.auth.accessToken;
	}
	const refreshed = await refreshAccessToken(settings.clientId, settings.tenant, settings.auth.refreshToken);
	settings.auth = refreshed;
	await onTokensUpdated(refreshed);
	return refreshed.accessToken;
}
