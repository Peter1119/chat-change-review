# Chat Change Review

Chat Change Review records which files an agent changed in each turn of a chat and lets you review those changes in a diff view that follows the Paseo built-in diff. You can leave comments on individual lines and send them back to the agent as one message.

## How it works

When an agent turn starts and ends, the plugin snapshots the Git working tree into a temporary index and a temporary object directory, then compares the two snapshots. It never writes to your repository or its index. Each turn that changed files gets a card in the chat timeline.

- The **Chat Change Review** panel in the main area shows the diff for the file you pick from a timeline card or the Explorer.
- The **Chat changed files** panel in the Explorer lists every file changed in the chat, either combined across turns or grouped by turn.
- Hover over a line number, or tap it on mobile, to comment on that line. Comments appear under the line and can be edited or deleted.
- **Send** in the Explorer panel sends all comments for the chat to its agent as a single message, with the file path, line number, the code line with one line of context on each side, and your comment. Sending is disabled while the agent is running.

Open both panels from the Command Center with **Open chat change review** and **Show files changed in this chat**.

## Data and storage

- Turn records and comments are stored only on the daemon host, under the plugin's `plugin-data` directory. Nothing is sent to any external service.
- The only outgoing action is **Send**, which posts one message to the agent of that chat.
- The plugin keeps the latest 30 turns per agent for up to 14 days. Each turn keeps the first 20 changed files and up to 24 KiB of diff per file. Untracked files ignored by Git are not collected, and untracked files larger than 1 MiB are listed without a diff.
- Up to 100 comments are kept per chat.

## Settings

There are no plugin settings. In the desktop app, the diff follows the code font size and monospace font chosen in Paseo settings. These values are read from the app's local storage, which is not an official plugin API, so this works only in the desktop and web app and may stop working in a future Paseo release. Elsewhere the diff uses the Paseo defaults: 12 px and the platform monospace font.

The interface is available in English and Korean and follows the app language.

## Limits

- Snapshots compare the whole working tree, so changes made in the same folder by another agent, an editor, or you during the turn are included. Turns that overlap in the same folder are marked.
- The turn start event arrives asynchronously, so a change made in the first moments of a turn can be missed.
- Syntax colors use a lightweight line-based highlighter, not a parser.
- Requires Paseo 0.15.4 or later.
