# Read receipts

Plugin id: `com.mst.read-receipt`.

Allowed senders see automatic status on their own direct messages, group messages, and public or private channel posts. Each of those is a separate switch. There is no per-message request. Recipients do not see extra controls.

## What the sender sees

On web and the desktop app, a mark appears after the message time:

- One grey check: the message is stored (**Sent**). In a direct message, the popover’s **Delivered** time is the server accept time (`post.CreateAt`). There is no later delivery acknowledgement.
- Two checks, one blue and one grey: some other members have opened the conversation.
- Two blue checks: every other member has opened the conversation.

Select the mark for the popover.

- A **direct message** shows **Seen** and **Delivered**.
- A **group message** or **channel** shows two lists: **Read** (name and time) and **Not yet read** (name only).

Times use the viewer’s timezone. The profile timezone is used when it is set: `manualTimezone` when `timezone.useAutomaticTimezone` is the string `"false"`, otherwise `automaticTimezone`. If neither IANA name is set, the browser timezone is used. Formatting is `Intl.DateTimeFormat` with the `timeZone` option.

Mattermost already shows **Sending** and **Message failed**. This plugin does not draw those.

When several messages from the same person are grouped, Mattermost hides the extra timestamp. The mark then sits at the end of that message instead of beside the time.

## What “Seen” means

Seen means the recipient’s channel view time is at or after the message (`LastViewedAt >= post.CreateAt`). Mattermost updates that time when someone opens the conversation in the browser, desktop app, or mobile app. It is not proof they read that specific text.

The author is not in the recipient list. In a group message, every other member is included. In a public or private channel, the same rule applies up to **50 other members**. A channel with more than 50 other members is not tracked. A channel that later grows past that cap stops being tracked.

The sender’s mobile app does not load this plugin, so ticks do not appear there. A recipient on mobile still advances the view time, and a sender on web or desktop sees that on the next check.

## Thread note

The optional thread reply is the same stored text for everyone. It does not contain a clock time or a “UTC” label. The seen instant is a post property on the note (`mst_read_receipt_seen_at`, epoch milliseconds). The webapp formats that instant in the viewer’s timezone. Older notes that still say `UTC` are rewritten in the webapp from that UTC clock time. The original message is not edited.

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
| Thread note when everyone has seen it | off | Optional reply. The checks are the status |

Leave the automatic switches off until an admin enables the ones you want. Turning on one does not turn on the others.

## Build and install

From the repository root:

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
