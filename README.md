# Microsoft To Do Sync (Obsidian Plugin)

Zwei-Wege-Synchronisation zwischen **Microsoft To Do** und einer normalen Markdown-Checkliste in Obsidian. Funktioniert auf Desktop **und Smartphone** (iOS/Android).

- Aufgaben aus Microsoft To Do erscheinen als `- [ ] ...` Checkboxen in einer Notiz deiner Wahl.
- Häkchen setzen/entfernen, Text ändern, neue Zeile hinzufügen oder Zeile löschen in Obsidian → wird bei der nächsten Synchronisierung zu Microsoft To Do übertragen.
- Neue/geänderte/gelöschte Aufgaben in Microsoft To Do (z. B. am Handy über die offizielle App eingegeben) → werden bei der nächsten Synchronisierung in die Notiz übernommen.

Die Zuordnung zwischen einer Checkbox-Zeile und der Microsoft-To-Do-Aufgabe erfolgt über eine unsichtbare Markierung am Zeilenende, z. B.:

```
- [ ] Milch kaufen %%todo-id:AAMkAGI...%%
```

Diese Markierung bitte nicht von Hand löschen oder verändern – Obsidian zeigt sie im Lesemodus ohnehin nicht an (`%% %%` ist ein Obsidian-Kommentar).

## Voraussetzung: Eigene Azure-App-Registrierung anlegen

Microsoft verlangt, dass jede App, die auf Microsoft-Konten zugreift, vorher registriert wird. Das ist kostenlos und dauert ca. 5 Minuten. **Das machst du einmalig selbst**, damit dein Zugriffs-Token nur dir gehört und nicht über einen fremden Server läuft.

1. Gehe (am PC, das geht am Handy schlecht) auf **https://portal.azure.com** und melde dich mit deinem Microsoft-Konto an.
2. Suche oben nach **„App registrations“** (App-Registrierungen) und klicke auf **„New registration“** (Neue Registrierung).
3. Trage ein:
   - **Name**: z. B. „Obsidian To Do Sync“ (beliebig).
   - **Supported account types**: **„Accounts in any organizational directory and personal Microsoft accounts“** auswählen (wichtig, sonst funktioniert es mit einem privaten Microsoft-Konto nicht).
   - **Redirect URI**: leer lassen.
4. Klicke auf **Register**.
5. Kopiere von der Übersichtsseite die **„Application (client) ID“** – die brauchst du gleich in den Plugin-Einstellungen.
6. Links im Menü auf **„Authentication“** (Authentifizierung) klicken → ganz unten bei **„Advanced settings“** den Schalter **„Allow public client flows“** auf **Yes** stellen → **Save**.
7. Links im Menü auf **„API permissions“** (API-Berechtigungen) → **„Add a permission“** → **„Microsoft Graph“** → **„Delegated permissions“** → nach **„Tasks.ReadWrite“** suchen, ankreuzen → **„Add permissions“**. (`offline_access` und `User.Read` sind meist schon automatisch dabei; falls nicht, ebenfalls hinzufügen.)

Das war's – ein Admin-Consent ist für diese Berechtigungen nicht nötig, du bestätigst das beim ersten Login einfach selbst.

## Plugin einrichten

1. Plugin installieren (siehe Abschnitt „Installation“ unten).
2. In den Plugin-Einstellungen bei **„Azure-Client-ID“** die Application (client) ID aus Schritt 5 oben eintragen.
3. Bei **„Microsoft-Konto“** auf **„Verbinden“** klicken. Es öffnet sich ein Fenster mit einem Code und einem Link.
4. Öffne den Link (auf dem Handy z. B. im Browser, kann auch ein anderes Gerät sein) und gib den angezeigten Code ein, dann bei Microsoft anmelden und bestätigen.
5. Zurück in Obsidian: Das Fenster zeigt „Verbunden als …“. Fenster schließen.
6. Auf **„Listen laden“** klicken und im Dropdown deine gewünschte Microsoft-To-Do-Liste auswählen (z. B. „Aufgaben“).
7. Optional anpassen:
   - **Notiz**: Pfad zur Notiz, z. B. `To Do.md`.
   - **Überschrift**: Nur der Abschnitt unter dieser Überschrift wird synchronisiert (Standard: `## Microsoft To Do`). Leer lassen, um die ganze Notiz zu verwenden.
   - **Automatisch synchronisieren**: Intervall in Minuten (0 = nur manuell).
8. Über das Sync-Symbol in der linken Leiste, den Befehl „Jetzt mit Microsoft To Do synchronisieren“ oder den Button in den Einstellungen synchronisieren.

## Installation

### Option A: BRAT (empfohlen, funktioniert gut am Handy)

Da dieses Plugin nicht im offiziellen Community-Store ist, installierst du es am einfachsten über das Plugin **BRAT** (Beta Reviewed Auto-update Tool):

1. In Obsidian: Einstellungen → Community-Plugins → durchsuchen → **„BRAT“** installieren und aktivieren.
2. BRAT-Einstellungen öffnen → **„Add Beta Plugin“**.
3. Als Repository `GeresV/Obsidian-Plugin` eintragen und bestätigen.
4. BRAT lädt das Plugin aus den GitHub-Releases herunter. Anschließend unter Community-Plugins **„Microsoft To Do Sync“** aktivieren.
5. Für Updates lädt BRAT künftig einfach die neueste Release-Version nach.

> Damit BRAT das Plugin findet, muss im Repo unter „Releases“ ein Release mit den Dateien `main.js`, `manifest.json` (und `versions.json`) angehängt sein. Das passiert automatisch über den beiliegenden GitHub-Actions-Workflow (`.github/workflows/release.yml`), sobald ein Tag im Format `v1.0.0` gepusht wird (z. B. `git tag v1.0.0 && git push origin v1.0.0`).

### Option B: Manuell (Desktop)

1. `npm install` und `npm run build` in diesem Ordner ausführen (erzeugt `main.js`).
2. Ordner `<dein-vault>/.obsidian/plugins/todo-sync/` anlegen.
3. `manifest.json`, `main.js` dort hineinkopieren.
4. Obsidian neu laden, Plugin unter Community-Plugins aktivieren.

## Grenzen & Hinweise

- **Konflikte**: Wenn eine Aufgabe seit der letzten Synchronisierung sowohl in Obsidian als auch in Microsoft To Do geändert wurde, gewinnt die **lokale (Obsidian-)Version**.
- **Formatierung**: Der Aufgabentitel wird als reiner Text übertragen. Markdown-Formatierung (`**fett**` etc.) im Titel wird in Microsoft To Do als Text angezeigt, nicht gerendert.
- **Löschen**: Löschst du eine Zeile in Obsidian, wird die Aufgabe auch bei Microsoft To Do gelöscht (nicht nur abgehakt). Wird eine Aufgabe bei Microsoft To Do gelöscht, wird standardmäßig auch die Obsidian-Zeile entfernt (in den Einstellungen umstellbar).
- **Zugangsdaten**: Das Zugriffs-Token wird lokal in der Plugin-Datei `data.json` deines Vaults gespeichert (wie bei den meisten Plugins, die sich mit einem Onlinedienst verbinden). Teile diese Datei nicht öffentlich und synchronisiere deinen `.obsidian`-Ordner nicht in ein öffentliches Repository.
- **Unterlisten/Verschachtelung**: Nur Checkbox-Zeilen auf einer Ebene innerhalb des gewählten Abschnitts werden verwaltet; andere Zeilen (Text, Überschriften) im selben Abschnitt bleiben unangetastet.

## Fehlerbehebung

- **„AADSTS7000218“ oder Fehler zu „public client“**: Schritt 6 oben („Allow public client flows“ = Yes) wurde nicht gespeichert.
- **„AADSTS65001“ / Zugriff abgelehnt**: Beim Login-Fenster wurden die angefragten Berechtigungen nicht bestätigt – Verbindung erneut versuchen und der Berechtigungsanfrage zustimmen.
- **Liste erscheint nicht beim „Listen laden“**: Sicherstellen, dass unter „API permissions“ wirklich `Tasks.ReadWrite` (nicht nur `Tasks.Read`) hinzugefügt wurde.
- **Sitzung abgelaufen / muss mich neu verbinden**: Passiert, wenn das gespeicherte Refresh-Token ungültig wird (z. B. nach Passwortänderung bei Microsoft). Einfach unter „Microsoft-Konto“ erneut verbinden.
