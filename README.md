# Mattermost read receipts

Team Edition plugin (`com.mst.read-receipt`, version 0.3.3) for allowed senders. It shows sent, delivered, and seen status on direct messages, group messages, and channels. Each of those is a separate switch. There is no per-message request. Recipients do not see extra controls.

Requires Mattermost Server 11.0.0 or newer.

## What the ticks mean

On the web app and the desktop app, a mark appears after the message time:

- One grey check: the message is stored (**Sent**).
- Two checks, one blue and one grey: some other members have opened the conversation.
- Two blue checks: every other member has opened the conversation.

Select the mark. The list opens beside that tick. It is drawn on the page, outside the message row, so the channel header does not clip it. Placement uses the tick’s position in the window. Near the bottom of the window the list flips above the tick. It stays next to the tick while the channel scrolls.

- A **direct message** shows **Seen** and **Delivered**. Delivered is the server accept time (`post.CreateAt`). There is no later delivery acknowledgement.
- A **group message** or **channel** shows **Read** (name and time) and **Not yet read** (name only). Clicking the tick opens those two lists.

Mattermost already shows **Sending** and **Message failed**. This plugin does not draw those.

When several messages from the same person are grouped, Mattermost hides the extra timestamp. The mark then sits at the end of that message.

The sender’s mobile app does not load this plugin, so ticks do not appear there. A recipient on mobile still advances the view time, and a sender on web or desktop sees that on the next check.

## Viewer timezone

Times use the viewer’s timezone from the profile when it is set:

- Use `manualTimezone` when `timezone.useAutomaticTimezone` is the string `"false"`.
- Otherwise use `automaticTimezone`.
- If neither IANA name is set, use the browser timezone.

Formatting is `Intl.DateTimeFormat` with the `timeZone` option.

## What Seen means

Seen means the recipient’s channel view time is at or after the message (`LastViewedAt >= post.CreateAt`). Mattermost updates that time when someone opens the conversation in the browser, desktop app, or mobile app. It is not proof they read that specific text.

The author is not in the recipient list. In a group message, every other member is included.

## Channels

Public and private channels use the same Read / Not yet read lists, up to **50 other members**. A channel with more than 50 other members is not tracked. A channel that later grows past that cap stops being tracked.

## Settings

Open **System Console → Plugins → MST Read Receipts**.

Automatic status stays off until an admin enables it. Turning on one switch does not turn on the others.

| Setting | Default |
|---|---|
| Enabled | on |
| Allowed roles | `system_admin` |
| Allowed user IDs | empty |
| Poll interval | 20 seconds (minimum 5) |
| Automatic status in direct messages | off |
| Automatic status in group messages | off |
| Automatic status in channels | off |
| Thread note | off |

People who should see receipts, and who do not have an allowed role, can be listed as comma-separated Mattermost user IDs.

Thread Seen and Read replies stay off. `PostPublicReceiptOnRead` stays false. The plugin does not post or update a receipt thread note. Existing replies are left in place. Status is the tick and the list beside it. The original message is not edited.

## Build and install

From the repository root, with Docker:

```bash
bash scripts/docker-build.sh
```

The tarball is `dist/com.mst.read-receipt.tar.gz`. Upload it in the System Console, or install with mmctl:

```bash
mmctl plugin add --force dist/com.mst.read-receipt.tar.gz
mmctl plugin enable com.mst.read-receipt
```

Health check: `GET /plugins/com.mst.read-receipt/api/v1/health`

Receipts are stored in Mattermost’s data directory under `com.mst.read-receipt/read_receipts.db`, so a plugin upgrade does not wipe them.

After enabling or upgrading, hard-refresh the browser. Desktop apps need **Clear Cache and Reload**.
