import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { ensureValidAccessToken, pollDeviceCodeToken, startDeviceCodeFlow } from "./auth";
import { getMyDisplayName, listTaskLists } from "./graphClient";
import { performSync } from "./sync";
import { DEFAULT_SETTINGS, GraphTaskList, TodoSyncSettings } from "./types";

export default class TodoSyncPlugin extends Plugin {
	settings: TodoSyncSettings;
	private syncing = false;
	private syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TodoSyncSettingTab(this.app, this));

		this.addRibbonIcon("refresh-cw", "Mit Microsoft To Do synchronisieren", () => {
			void this.syncNow();
		});

		this.addCommand({
			id: "sync-now",
			name: "Jetzt mit Microsoft To Do synchronisieren",
			callback: () => void this.syncNow(),
		});

		this.addCommand({
			id: "connect-account",
			name: "Mit Microsoft-Konto verbinden",
			callback: () => this.connectAccount(),
		});

		this.applyAutoSyncInterval();
	}

	onunload() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	applyAutoSyncInterval() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
		if (this.settings.autoSyncMinutes > 0) {
			const ms = this.settings.autoSyncMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => void this.syncNow(true), ms);
			this.registerInterval(this.syncIntervalId);
		}
	}

	async syncNow(silent = false) {
		if (this.syncing) {
			if (!silent) new Notice("Synchronisierung läuft bereits …");
			return;
		}
		if (!this.settings.auth) {
			if (!silent) new Notice("Bitte zuerst in den Plugin-Einstellungen mit Microsoft verbinden.");
			return;
		}
		if (!this.settings.taskListId) {
			if (!silent) new Notice("Bitte zuerst in den Plugin-Einstellungen eine To-Do-Liste auswählen.");
			return;
		}
		this.syncing = true;
		if (!silent) new Notice("Synchronisiere mit Microsoft To Do …");
		try {
			const result = await performSync(this.app, this.settings, () => this.saveSettings());
			const parts: string[] = [];
			if (result.pulled) parts.push(`${result.pulled} aktualisiert`);
			if (result.pushed) parts.push(`${result.pushed} gesendet`);
			if (result.createdRemote) parts.push(`${result.createdRemote} neu angelegt`);
			if (result.deletedRemote) parts.push(`${result.deletedRemote} gelöscht`);
			if (result.conflicts) parts.push(`${result.conflicts} Konflikte (lokal gewonnen)`);
			new Notice(parts.length ? `To Do Sync: ${parts.join(", ")}` : "To Do Sync: keine Änderungen");
		} catch (e) {
			console.error("todo-sync: Synchronisierung fehlgeschlagen", e);
			new Notice(`To Do Sync Fehler: ${e instanceof Error ? e.message : String(e)}`, 10000);
		} finally {
			this.syncing = false;
		}
	}

	connectAccount() {
		if (!this.settings.clientId) {
			new Notice("Bitte zuerst eine Client-ID in den Plugin-Einstellungen eintragen (siehe README).");
			return;
		}
		new DeviceCodeModal(this.app, this).open();
	}

	async disconnectAccount() {
		this.settings.auth = null;
		this.settings.accountLabel = null;
		this.settings.deltaLink = null;
		await this.saveSettings();
		new Notice("Von Microsoft getrennt.");
	}
}

class DeviceCodeModal extends Modal {
	private plugin: TodoSyncPlugin;
	private cancelled = false;

	constructor(app: App, plugin: TodoSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.cancelled = false;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Mit Microsoft verbinden" });
		const status = contentEl.createEl("p", { text: "Gerätecode wird angefordert …" });

		void this.run(status);
	}

	onClose() {
		this.cancelled = true;
		this.contentEl.empty();
	}

	private async run(status: HTMLParagraphElement) {
		const settings = this.plugin.settings;
		try {
			const deviceCode = await startDeviceCodeFlow(settings.clientId, settings.tenant);

			status.setText("Öffne diese Seite auf einem beliebigen Gerät und gib den Code ein:");

			const codeBox = this.contentEl.createEl("p");
			const codeEl = codeBox.createEl("strong", { text: deviceCode.user_code });
			codeEl.style.fontSize = "1.6em";
			codeEl.style.userSelect = "text";

			const linkEl = this.contentEl.createEl("a", {
				text: deviceCode.verification_uri,
				href: deviceCode.verification_uri,
			});
			linkEl.style.display = "block";
			linkEl.style.marginBottom = "1em";

			const copyBtn = this.contentEl.createEl("button", { text: "Code kopieren" });
			copyBtn.onclick = async () => {
				await navigator.clipboard.writeText(deviceCode.user_code);
				new Notice("Code kopiert.");
			};

			const waitingText = this.contentEl.createEl("p", { text: "Warte auf Bestätigung …" });

			const tokens = await pollDeviceCodeToken(
				settings.clientId,
				settings.tenant,
				deviceCode.device_code,
				deviceCode.interval,
				deviceCode.expires_in,
				() => this.cancelled
			);

			settings.auth = tokens;
			await this.plugin.saveSettings();

			waitingText.setText("Angemeldet. Lade Kontoinformationen …");
			try {
				settings.accountLabel = await getMyDisplayName(tokens.accessToken);
				await this.plugin.saveSettings();
			} catch {
				/* not critical if this fails */
			}

			waitingText.setText(`Verbunden als ${settings.accountLabel ?? "Microsoft-Konto"}. Du kannst dieses Fenster schließen.`);
		} catch (e) {
			if (this.cancelled) return;
			status.setText(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

class TodoSyncSettingTab extends PluginSettingTab {
	plugin: TodoSyncPlugin;
	private availableLists: GraphTaskList[] = [];

	constructor(app: App, plugin: TodoSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		containerEl.createEl("h2", { text: "Microsoft To Do Sync" });

		new Setting(containerEl)
			.setName("Azure-Client-ID")
			.setDesc(
				"Die Application (client) ID deiner eigenen Azure-App-Registrierung. Siehe README für die Anleitung dazu."
			)
			.addText((text) =>
				text
					.setPlaceholder("00000000-0000-0000-0000-000000000000")
					.setValue(settings.clientId)
					.onChange(async (value) => {
						settings.clientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Microsoft-Konto")
			.setDesc(
				settings.auth
					? `Verbunden als ${settings.accountLabel ?? "Microsoft-Konto"}.`
					: "Nicht verbunden."
			)
			.addButton((btn) =>
				btn.setButtonText(settings.auth ? "Trennen" : "Verbinden").onClick(async () => {
					if (settings.auth) {
						await this.plugin.disconnectAccount();
						this.display();
					} else {
						this.plugin.connectAccount();
					}
				})
			);

		const listSetting = new Setting(containerEl)
			.setName("To-Do-Liste")
			.setDesc(
				settings.taskListName
					? `Aktuell ausgewählt: ${settings.taskListName}`
					: "Noch keine Liste ausgewählt."
			);

		listSetting.addDropdown((dropdown) => {
			if (this.availableLists.length === 0 && settings.taskListId) {
				dropdown.addOption(settings.taskListId, settings.taskListName || settings.taskListId);
			}
			for (const list of this.availableLists) {
				dropdown.addOption(list.id, list.displayName);
			}
			dropdown.setValue(settings.taskListId);
			dropdown.onChange(async (value) => {
				const chosen = this.availableLists.find((l) => l.id === value);
				settings.taskListId = value;
				settings.taskListName = chosen?.displayName ?? settings.taskListName;
				settings.deltaLink = null;
				settings.taskCache = {};
				await this.plugin.saveSettings();
			});
		});

		listSetting.addButton((btn) =>
			btn.setButtonText("Listen laden").onClick(async () => {
				if (!settings.auth) {
					new Notice("Bitte zuerst mit Microsoft verbinden.");
					return;
				}
				try {
					const token = await ensureValidAccessToken(settings, async (t) => {
						settings.auth = t;
						await this.plugin.saveSettings();
					});
					this.availableLists = await listTaskLists(token);
					new Notice(`${this.availableLists.length} Liste(n) gefunden.`);
					this.display();
				} catch (e) {
					new Notice(`Fehler beim Laden der Listen: ${e instanceof Error ? e.message : String(e)}`);
				}
			})
		);

		new Setting(containerEl)
			.setName("Notiz")
			.setDesc("Pfad zur Notiz, in der die Checkliste synchronisiert wird.")
			.addText((text) =>
				text
					.setPlaceholder("To Do.md")
					.setValue(settings.notePath)
					.onChange(async (value) => {
						settings.notePath = value.trim() || DEFAULT_SETTINGS.notePath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Überschrift")
			.setDesc(
				"Nur der Abschnitt unter dieser Überschrift wird synchronisiert (bis zur nächsten Überschrift gleicher oder höherer Ebene). Leer lassen, um die ganze Notiz zu verwenden."
			)
			.addText((text) =>
				text
					.setPlaceholder("## Microsoft To Do")
					.setValue(settings.heading)
					.onChange(async (value) => {
						settings.heading = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Wenn eine Aufgabe in Microsoft To Do gelöscht wird")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("remove", "Zeile in Obsidian auch entfernen")
					.addOption("keep", "Zeile in Obsidian behalten (Verknüpfung wird aufgehoben)")
					.setValue(settings.onRemoteDelete)
					.onChange(async (value) => {
						settings.onRemoteDelete = value as "remove" | "keep";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Automatisch synchronisieren (Minuten)")
			.setDesc("0 = deaktiviert, dann nur manuell über Befehl/Symbol.")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(settings.autoSyncMinutes))
					.onChange(async (value) => {
						const n = Number(value);
						settings.autoSyncMinutes = Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
						this.plugin.applyAutoSyncInterval();
					})
			);

		new Setting(containerEl).setName("Jetzt synchronisieren").addButton((btn) =>
			btn
				.setButtonText("Sync")
				.setCta()
				.onClick(() => void this.plugin.syncNow())
		);
	}
}
