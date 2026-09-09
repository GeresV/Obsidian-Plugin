import { App, TFile, normalizePath } from "obsidian";
import { ensureValidAccessToken } from "./auth";
import { GraphError, createTask, deleteTask, fetchDeltaTasks, updateTask } from "./graphClient";
import { TodoSyncSettings } from "./types";

const ID_MARKER_RE = /\s*%%todo-id:([^%]+)%%/;
const TASK_LINE_RE = /^(\s*)-\s\[([ xX])\]\s?(.*)$/;
const HEADING_RE = /^(#{1,6})\s/;

export interface SyncResult {
	pulled: number;
	pushed: number;
	createdRemote: number;
	deletedRemote: number;
	conflicts: number;
}

interface TaskEntry {
	type: "task";
	indent: string;
	checked: boolean;
	title: string;
	id: string | null;
}
interface PlainEntry {
	type: "line";
	raw: string;
}
type Entry = TaskEntry | PlainEntry;

function parseTaskLine(line: string): TaskEntry | null {
	const m = line.match(TASK_LINE_RE);
	if (!m) return null;
	const [, indent, checkChar, rest] = m;
	const idMatch = rest.match(ID_MARKER_RE);
	const id = idMatch ? idMatch[1] : null;
	const title = rest.replace(ID_MARKER_RE, "").trim();
	return { type: "task", indent, checked: checkChar.toLowerCase() === "x", title, id };
}

function renderEntry(entry: Entry): string {
	if (entry.type === "line") return entry.raw;
	const box = entry.checked ? "x" : " ";
	const idPart = entry.id ? ` %%todo-id:${entry.id}%%` : "";
	return `${entry.indent}- [${box}] ${entry.title}${idPart}`;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
	const idx = path.lastIndexOf("/");
	if (idx === -1) return;
	const folder = path.slice(0, idx);
	if (folder && !app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder).catch(() => {
			/* may already exist due to a race, ignore */
		});
	}
}

async function loadFile(app: App, notePath: string): Promise<TFile> {
	const path = normalizePath(notePath);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	if (existing) throw new Error(`"${notePath}" ist ein Ordner, keine Notiz.`);
	await ensureFolderExists(app, path);
	return app.vault.create(path, "");
}

/**
 * Finds the [start, end) line range of the managed section within `lines`.
 * When `heading` is empty, the whole file is treated as the section.
 * If the heading doesn't exist yet, it is appended to `lines` (mutating the array).
 *
 * The anchor line is usually a Markdown heading ("## Microsoft To Do"), whose nesting
 * level tells us exactly where the section ends (the next heading of equal-or-higher
 * level). Anything else - a callout header like "> [!todo]- Microsoft To Do", or plain
 * text - has no such nesting concept, so for those the section instead ends at the next
 * blank line, matching how Obsidian itself stops rendering a callout/blockquote there.
 */
function locateSection(lines: string[], heading: string): { start: number; end: number } {
	const trimmedHeading = heading.trim();
	if (!trimmedHeading) {
		return { start: 0, end: lines.length };
	}
	const headingLevelMatch = trimmedHeading.match(HEADING_RE);
	const isAtxHeading = headingLevelMatch !== null;
	const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 1;

	let headingIdx = lines.findIndex((l) => l.trim() === trimmedHeading);
	if (headingIdx === -1) {
		if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
			lines.push("");
		}
		lines.push(trimmedHeading);
		headingIdx = lines.length - 1;
	}

	let end = lines.length;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		if (!isAtxHeading && lines[i].trim() === "") {
			end = i;
			break;
		}
		const m = lines[i].match(HEADING_RE);
		if (m && m[1].length <= headingLevel) {
			end = i;
			break;
		}
	}
	return { start: headingIdx + 1, end };
}

export async function performSync(
	app: App,
	settings: TodoSyncSettings,
	saveSettings: () => Promise<void>
): Promise<SyncResult> {
	if (!settings.taskListId) {
		throw new Error("Es wurde noch keine Microsoft To Do Liste ausgewählt (siehe Einstellungen).");
	}

	const token = await ensureValidAccessToken(settings, async (tokens) => {
		settings.auth = tokens;
		await saveSettings();
	});

	let deltaFetch;
	try {
		deltaFetch = await fetchDeltaTasks(token, settings.taskListId, settings.deltaLink);
	} catch (e) {
		if (e instanceof GraphError && (e.status === 410 || e.status === 400)) {
			// stored delta token is stale/invalid -> fall back to a full resync
			deltaFetch = await fetchDeltaTasks(token, settings.taskListId, null);
		} else {
			throw e;
		}
	}
	const { tasks: remoteChanges, deltaLink: newDeltaLink } = deltaFetch;

	const file = await loadFile(app, settings.notePath);
	const originalContent = await app.vault.read(file);
	const lines = originalContent.split("\n");
	const { start, end } = locateSection(lines, settings.heading);

	const entries: Entry[] = lines
		.slice(start, end)
		.map((line): Entry => parseTaskLine(line) ?? { type: "line", raw: line });

	const localById = new Map<string, { entryIndex: number; checked: boolean; title: string }>();
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "task" && e.id) {
			localById.set(e.id, { entryIndex: i, checked: e.checked, title: e.title });
		}
	}

	const cache = settings.taskCache;
	const idsInCacheBefore = new Set(Object.keys(cache));
	const result: SyncResult = { pulled: 0, pushed: 0, createdRemote: 0, deletedRemote: 0, conflicts: 0 };

	const entryIndicesToRemove = new Set<number>();
	const newEntriesFromRemote: TaskEntry[] = [];
	const idsHandledByRemoteChange = new Set<string>();

	for (const rt of remoteChanges) {
		const id = rt.id;
		idsHandledByRemoteChange.add(id);

		if (rt["@removed"]) {
			const local = localById.get(id);
			if (local) {
				if (settings.onRemoteDelete === "remove") {
					entryIndicesToRemove.add(local.entryIndex);
				} else {
					(entries[local.entryIndex] as TaskEntry).id = null;
				}
			}
			delete cache[id];
			continue;
		}

		const checked = rt.status === "completed";
		const title = rt.title ?? "";
		const local = localById.get(id);

		if (local) {
			const cached = cache[id];
			const localChanged = !!cached && (local.checked !== cached.checked || local.title !== cached.title);
			if (localChanged) {
				// changed on both sides since last sync: local wins, will be pushed below
				result.conflicts++;
			} else {
				const entry = entries[local.entryIndex] as TaskEntry;
				entry.checked = checked;
				entry.title = title;
				cache[id] = { checked, title };
				result.pulled++;
			}
		} else {
			newEntriesFromRemote.push({ type: "task", indent: "", checked, title, id });
			cache[id] = { checked, title };
			result.pulled++;
		}
	}

	// Lines whose id used to exist but is no longer present in the note = user deleted them locally.
	for (const id of idsInCacheBefore) {
		if (!localById.has(id) && !idsHandledByRemoteChange.has(id)) {
			try {
				await deleteTask(token, settings.taskListId, id);
				result.deletedRemote++;
			} catch (e) {
				if (!(e instanceof GraphError && e.status === 404)) throw e;
			}
			delete cache[id];
		}
	}

	// Push local changes (edits to already-linked tasks) that weren't just overwritten by a remote pull.
	for (const [id, local] of localById) {
		if (entryIndicesToRemove.has(local.entryIndex)) continue;
		const cached = cache[id];
		if (!cached || local.checked !== cached.checked || local.title !== cached.title) {
			await updateTask(token, settings.taskListId, id, { title: local.title, checked: local.checked });
			cache[id] = { checked: local.checked, title: local.title };
			result.pushed++;
		}
	}

	// Create remote tasks for local checklist lines that don't have an id yet.
	for (const entry of entries) {
		if (entry.type === "task" && entry.id === null && entry.title.length > 0) {
			const created = await createTask(token, settings.taskListId, entry.title, entry.checked);
			entry.id = created.id;
			cache[created.id] = { checked: entry.checked, title: entry.title };
			result.createdRemote++;
		}
	}

	const newSectionLines = entries
		.filter((_, i) => !entryIndicesToRemove.has(i))
		.map(renderEntry)
		.concat(newEntriesFromRemote.map(renderEntry));

	const newLines = [...lines.slice(0, start), ...newSectionLines, ...lines.slice(end)];
	const newContent = newLines.join("\n");
	if (newContent !== originalContent) {
		await app.vault.modify(file, newContent);
	}

	settings.deltaLink = newDeltaLink || settings.deltaLink;
	await saveSettings();

	return result;
}
