# Heading Link Sync

Heading Link Sync updates every link to a heading when you retype that heading in the editor. You do not open a menu and you see no dialog. Change `## Milestones` to `## Roadmap`, move the cursor off the line, and `[[Project Plan#Milestones]]` in every other note becomes `[[Project Plan#Roadmap]]`.

Obsidian already has "Rename this heading" and "Rename block ID" in the editor menu, but they open a dialog first. When you type over a heading, the links to it break without a warning.

Heading sync for wikilinks and embeds is free. Pro adds Markdown links, block ID links, a preview of the changes and a report of broken heading links. Pro costs $5 a month or $15 once, through GitHub Sponsors.

## Features

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/heading-link-sync.gif" alt="Typing a new heading text, then a meeting note that shows the updated link" width="720">

### Rename a heading by typing

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/rename-notice.png" alt="The plan note after a heading edit, with the notice Updated 36 links in 31 notes and an Undo button" width="720">

The plugin waits until you move the cursor off the heading line, or until you stop typing for 1.5 seconds. Then it updates the links and shows one notice, for example "Updated 36 links in 31 notes", with an Undo button.

Undo puts back the exact text of every changed link, also after you edited other text in those notes. If Undo cannot find a changed link for certain, it leaves that note as it is and the notice reports it. The command "Undo the last link update" does the same.

### Every wikilink form follows

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/linked-note.png" alt="A meeting note where an alias link, an embed and a property link now point to the new heading" width="720">

These forms are updated in the free version:

- `[[Note#Heading]]` and `[[Note#Heading|alias]]`, where the alias stays as it is
- embeds such as `![[Note#Heading]]`
- `[[#Heading]]` inside the same note
- nested paths such as `[[Note#Milestones#Phase 1]]`
- wikilinks in properties, such as `related: "[[Note#Heading]]"`

Links in tables keep their escaped pipe. Links in fenced code, inline code and math blocks never change. The plugin finds the same links as the app does, and it compares heading text the same way: case and special characters such as `:` or `?` do not matter.

### Ask first

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/ask-first.png" alt="A dialog that asks Update links? with the old and new heading and the count of links and notes" width="720">

Set "When a heading changes" to "Ask first" if you want to confirm each update. The dialog names the old and new heading and the number of links and notes. Skip leaves every note as it is.

### Markdown links (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/markdown-links.png" alt="A note with Markdown links whose heading part now reads Roadmap with %20 for the spaces" width="720">

Pro also updates `[text](Note.md#Heading)` links. It writes spaces as `%20`, as the app does when it makes a Markdown link. Links in angle brackets keep raw spaces, and fully encoded links stay fully encoded. Without Pro, the notice tells you how many Markdown links it did not change.

### Block IDs (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/block-ids.png" alt="A status report where the link to a block now uses the new block ID costs" width="720">

Edit a `^block-id` at the end of a paragraph or under a table, and Pro updates every `[[Note#^block-id]]` link and embed to it. Block IDs match in any letter case, as in the app.

### Preview the changes (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/preview.png" alt="A review dialog that lists each note and line with the old link crossed out, the new link, and a check box" width="720">

With Pro, "Ask first" lists the changes: the note, the line, the old link and the new link. Clear a check box to keep one link as it is, then select "Apply selected".

The list shows the first 500 changes. If there are more, a line above the buttons counts the links that are not shown, and "Apply selected" changes them too.

### Broken heading link report (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/broken-links.png" alt="A report of broken heading and block links, each with the closest heading and a Fix button" width="720">

The command "Find broken heading and block links" lists every link whose note exists but whose heading or block ID does not. For each one it suggests the closest heading or block ID in that note. Select Fix for one link, or "Fix all with a suggestion".

## Install

After the community listing goes live, open Settings, Community plugins, Browse. Search for "Heading Link Sync". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put them in `<vault>/.obsidian/plugins/heading-link-sync/`. Reload the list of community plugins, then turn on Heading Link Sync.

It needs Obsidian 1.13.4 or newer. It was tested on desktop with Obsidian 1.13.4 and 1.14.4.

## Usage

1. Turn on the plugin.
2. Open a note that other notes link to, and type over the text of one of its headings.
3. Move the cursor to another line, or stop typing for a moment.
4. Read the notice. Select Undo if you did not want the change.

The plugin acts only on edits that you make in the editor, not on changes from sync tools or git. A change of letter case alone is not a rename, because every link still works.

## Pro

Pro unlocks Markdown links, block ID links, the preview and the broken link report. To get it:

1. Sponsor [theluckystrike on GitHub Sponsors](https://github.com/sponsors/theluckystrike) with $5 a month, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Heading Link Sync and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

A negative sponsorship answer turns Pro off. The free heading sync keeps working.

## Settings

<img src="https://raw.githubusercontent.com/theluckystrike/heading-link-sync/HEAD/docs/settings.png" alt="Settings with the Pro section, the update mode, the pause, the excluded folders and the two Pro switches" width="720">

| Setting | Default | Allowed values |
| --- | --- | --- |
| When a heading changes | Update links at once | Update links at once, or Ask first |
| Pause before an update | 1500 | 500 to 5000 milliseconds |
| Excluded folders | empty | One folder per line |
| Update Markdown links | On | On or off (Pro) |
| Update block ID links | On | On or off (Pro) |

Notes in an excluded folder are never changed, and heading edits in them do not update other notes.

## FAQ

### How is this different from "Rename this heading"?

The core command opens a dialog, and you must remember to use it before you edit. Heading Link Sync works on the edit that you already made. If you use the core dialog, the plugin sees that the links already point to the new text and does nothing.

### What if I stop typing in the middle of a word?

The links follow the half-typed text, then follow again when you finish. Raise the pause if this happens often.

### Does it change notes that do not link to the heading?

No. It reads only the notes that the app lists as linking to the edited note, and it writes only the changed part of each link.

### What happens with two headings of the same text?

A plain link goes to the first heading. Heading Link Sync follows the same rule. If you rename the second heading, only nested links that point to it change. If a rename would send an old link to a different heading, the plugin adds the parent heading to the link, for example `[[Note#Part B#Notes]]`. If no such path exists, it leaves the link alone and says so.

### What does it leave alone?

Links in code and math, links to a heading that does not exist, links that would point to another heading after the rename, and links in properties when the new text contains a quote mark. The notice counts each of them.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Heading Link Sync makes no network requests. Sign in uses the GitHub device flow. Heading Link Sync sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Heading Link Sync sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report bugs and feature requests in this repository's issue tracker. Include your Obsidian version, the old and new heading, and one link that did not update.

To build from source:

```
npm ci
npm run build
npm test
```

The tests check 53 golden cases for the link rules. An end-to-end test types a new heading in Obsidian and checks the text of 31 linking notes.

## License

MIT
