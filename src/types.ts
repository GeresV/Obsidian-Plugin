export interface AuthTokens {
	accessToken: string;
	refreshToken: string;
	/** epoch milliseconds */
	expiresAt: number;
}

export interface TaskCacheEntry {
	checked: boolean;
	title: string;
}

export type RemoteDeleteBehavior = "remove" | "keep";

export interface TodoSyncSettings {
	clientId: string;
	/** Azure AD tenant, "common" allows personal + work/school accounts */
	tenant: string;
	notePath: string;
	heading: string;
	taskListId: string;
	taskListName: string;
	onRemoteDelete: RemoteDeleteBehavior;
	/** 0 disables the automatic timer, sync is still available via command/ribbon */
	autoSyncMinutes: number;
	deltaLink: string | null;
	taskCache: Record<string, TaskCacheEntry>;
	auth: AuthTokens | null;
	accountLabel: string | null;
}

export const DEFAULT_SETTINGS: TodoSyncSettings = {
	clientId: "",
	tenant: "common",
	notePath: "To Do.md",
	heading: "## Microsoft To Do",
	taskListId: "",
	taskListName: "",
	onRemoteDelete: "remove",
	autoSyncMinutes: 0,
	deltaLink: null,
	taskCache: {},
	auth: null,
	accountLabel: null,
};

export interface GraphTaskList {
	id: string;
	displayName: string;
}

export interface GraphTask {
	id: string;
	title: string;
	status: string;
	"@removed"?: { reason: string };
}

export const GRAPH_SCOPES = "Tasks.ReadWrite offline_access";
