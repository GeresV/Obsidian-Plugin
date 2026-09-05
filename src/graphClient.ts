import { requestUrl } from "obsidian";
import { GraphTask, GraphTaskList } from "./types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function graphRequest(token: string, url: string, method: string, body?: unknown): Promise<any> {
	const res = await requestUrl({
		url,
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
		throw: false,
	});
	if (res.status >= 200 && res.status < 300) {
		// DELETE returns 204 with no body
		return res.text ? res.json : {};
	}
	const message = res.json?.error?.message ?? res.text ?? `HTTP ${res.status}`;
	throw new GraphError(res.status, `Microsoft Graph Fehler (${res.status}): ${message}`);
}

export async function getMyDisplayName(token: string): Promise<string> {
	const me = await graphRequest(token, `${GRAPH_BASE}/me?$select=displayName,userPrincipalName`, "GET");
	return me.displayName ?? me.userPrincipalName ?? "Microsoft-Konto";
}

export async function listTaskLists(token: string): Promise<GraphTaskList[]> {
	const lists: GraphTaskList[] = [];
	let url: string | undefined = `${GRAPH_BASE}/me/todo/lists?$top=100`;
	while (url) {
		const body = await graphRequest(token, url, "GET");
		if (Array.isArray(body.value)) {
			lists.push(...body.value.map((l: any) => ({ id: l.id, displayName: l.displayName })));
		}
		url = body["@odata.nextLink"];
	}
	return lists;
}

/**
 * Fetches changed tasks since the last sync using Graph's delta query.
 * Pass `deltaLink: null` for the first sync (returns the full current set of tasks).
 * On subsequent calls, pass the `deltaLink` returned last time to only get what changed
 * (including deletions, marked with an `@removed` property).
 */
export async function fetchDeltaTasks(
	token: string,
	listId: string,
	deltaLink: string | null
): Promise<{ tasks: GraphTask[]; deltaLink: string }> {
	let url = deltaLink ?? `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks/delta?$top=100`;
	const tasks: GraphTask[] = [];
	let finalDeltaLink = "";

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const body = await graphRequest(token, url, "GET");
		if (Array.isArray(body.value)) {
			tasks.push(...body.value);
		}
		if (body["@odata.nextLink"]) {
			url = body["@odata.nextLink"];
			continue;
		}
		finalDeltaLink = body["@odata.deltaLink"] ?? "";
		break;
	}
	return { tasks, deltaLink: finalDeltaLink };
}

export async function createTask(token: string, listId: string, title: string, checked: boolean): Promise<GraphTask> {
	return graphRequest(token, `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks`, "POST", {
		title,
		status: checked ? "completed" : "notStarted",
	});
}

export async function updateTask(
	token: string,
	listId: string,
	taskId: string,
	changes: { title?: string; checked?: boolean }
): Promise<void> {
	const body: Record<string, string> = {};
	if (changes.title !== undefined) body.title = changes.title;
	if (changes.checked !== undefined) body.status = changes.checked ? "completed" : "notStarted";
	await graphRequest(
		token,
		`${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
		"PATCH",
		body
	);
}

export async function deleteTask(token: string, listId: string, taskId: string): Promise<void> {
	await graphRequest(
		token,
		`${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
		"DELETE"
	);
}
