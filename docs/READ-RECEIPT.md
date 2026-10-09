# Read receipts

Plugin id: `com.mst.read-receipt`.

Allowed senders see automatic status on their own direct messages, group messages, and public or private channel posts. Each of those is a separate switch. There is no per-message “request receipt” action. Recipients do not see extra controls.

## What the sender sees

On web and the desktop app, a mark appears after the message time:

- One grey check: the message is stored (**Sent**). In a direct message, the popover’s **Delivered** time is the server accept time (`post.CreateAt`). There is no later delivery acknowledgement.
- Two checks, one blue and one grey: some other members have opened the conversation.
- Two blue checks: every other member has opened the conversation.

Select the mark for the popover. It opens just below that tick, or just above it when the tick is near the bottom of the window. The list is drawn outside the message row so the header does not clip it, and it stays next to the tick while the channel scrolls.

- A **direct message** shows **Seen** and **Delivered**.
- A **group message** or **channel** shows two lists: **Read** (name and time) and **Not yet read** (name only). A channel is never shown as Seen / Delivered. That includes a status payload whose channel type is missing.

Times use the viewer’s timezone. The profile timezone is used when it is set: `manualTimezone` when `timezone.useAutomaticTimezone` is the string `"false"`, otherwise `automaticTimezone`. If neither IANA name is set, the browser timezone is used. Formatting is `Intl.DateTimeFormat` with the `timeZone` option.

Mattermost already shows **Sending** and **Message failed**. This plugin does not draw those.

When several messages from the same person are grouped, Mattermost hides the extra timestamp. The mark then sits at the end of that message instead of beside the time.

## What “Seen” means

Seen means the recipient has opened the conversation (`LastViewedAt >= post.CreateAt`). Mattermost updates that field when someone opens the conversation in the browser, desktop app, or mobile app. The clock in the popover is not that field: it often stays equal to the message. A later open stores the server time of the first check that sees it, so Seen is after Delivered. If they already had the conversation open when the message was sent, Seen can match Delivered. A stored read time does not move backward. It is not proof they read that specific text.

The author is not in the recipient list. In a group message, every other member is included. In a public or private channel, the same rule applies up to **50 other members**. A channel with more than 50 other members is not tracked, so the poller does not walk a company-wide channel. A channel that later grows past that cap stops being tracked.

The Android and iOS apps do not load webapp plugin bundles, so the ticks from `registerPostHeaderComponent` never appear there. A recipient on mobile still advances the view time, and a sender on web or desktop sees that on the next check.

## Thread note

The thread note is off. The plugin does not post or update a reply that says Seen, Read, or Not yet read. Status is the tick on web, and the click popover. Existing thread replies are left in the channels. The original message is not edited.

Older notes that still say `UTC` are rewritten on web from `mst_read_receipt_seen_at`. The Android and iOS apps still do not load the web ticks.

## Switches

System Console → Plugins → MST Read Receipts.

| Setting | Default | Use |
|---|---|---|
| Enabled | on | Master switch |
| Allowed roles | `system_admin` | Role names, comma-separated |
| Allowed user IDs | empty | Mattermost user IDs for people without a matching role |
| Poll interval | 20 seconds | How often open receipts are checked. Minimum 5 |
| Automatic status in direct messages | off | Every new DM from an allowed sender |
| Automatic status in group messages | off | Separate from direct messages and channels |
| Automatic status in channels | off | Public and private channels. Skips channels with more than 50 other members |
| Thread note | off | Not posted. The tick on web is the status. Existing replies stay |

Leave the automatic switches off until the pilot group is chosen. Turning on one does not turn on the others.

There is no HR role on this server. Put those people in **Allowed user IDs**, then turn on the automatic switches you want.

## Build and install

From `read-receipt/`:

```bash
bash scripts/docker-build.sh
```

The tarball is `dist/com.mst.read-receipt.tar.gz`. Upload it in the System Console, or:

```bash
mmctl plugin add --force dist/com.mst.read-receipt.tar.gz
mmctl plugin enable com.mst.read-receipt
```

Health check: `GET /plugins/com.mst.read-receipt/api/v1/health`

Receipts are stored in Mattermost’s data directory under `com.mst.read-receipt/read_receipts.db`, so a plugin upgrade does not wipe them.

After enabling or upgrading, hard-refresh the browser. Desktop apps need **Clear Cache and Reload**.

`scripts/post-upgrade-mattermost.sh` reinstalls this plugin with the other custom plugins. It does not turn the automatic switches on.
