package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

func (p *ReadReceiptPlugin) pollLoop(stop <-chan struct{}) {
	p.refreshOpen()
	interval := time.Duration(p.pollInterval()) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			next := time.Duration(p.pollInterval()) * time.Second
			if next != interval {
				ticker.Reset(next)
				interval = next
			}
			p.refreshOpen()
		}
	}
}

func (p *ReadReceiptPlugin) refreshOpen() {
	if !p.getConfiguration().Enabled || p.store == nil {
		return
	}
	rows, err := p.store.ListOpen(100)
	if err != nil {
		p.API.LogError("read-receipt poll list failed", "err", err.Error())
		return
	}
	if len(rows) == 0 {
		return
	}
	updated := 0
	for i := range rows {
		if p.refreshOne(&rows[i]) {
			updated++
		}
	}
	p.API.LogDebug("read-receipt poll", "open", len(rows), "updated", updated)
}

func (p *ReadReceiptPlugin) refreshOne(row *receiptRow) bool {
	members, skip := p.receiptMembers(row.ChannelID, row.AuthorID)
	if skip {
		return p.markSkipped(row)
	}
	if len(members) == 0 {
		return false
	}
	status, states, changed := evaluate(row.AuthorID, row.CreateAt, members, row.States, time.Now().UnixMilli(), false)
	if status == row.Status && !changed {
		return false
	}
	prev := row.Status
	row.Status = status
	row.States = states
	if err := p.store.SaveState(row.PostID, status, states, row.PublicNoteAt); err != nil {
		p.API.LogError("read-receipt save failed", "err", err.Error(), "post_id", row.PostID)
		return false
	}
	if status != prev || changed {
		p.publishStatus(row.AuthorID, row.PostID)
	}
	return true
}

func (p *ReadReceiptPlugin) markSkipped(row *receiptRow) bool {
	if row == nil || row.Status == statusSkipped {
		return false
	}
	p.API.LogInfo("read-receipt stopped, channel over member cap", "post_id", row.PostID, "channel_id", row.ChannelID, "cap", channelRecipientCap)
	row.Status = statusSkipped
	if err := p.store.SaveState(row.PostID, statusSkipped, row.States, row.PublicNoteAt); err != nil {
		p.API.LogError("read-receipt skip save failed", "err", err.Error(), "post_id", row.PostID)
		return false
	}
	p.publishStatus(row.AuthorID, row.PostID)
	return true
}

func (p *ReadReceiptPlugin) publishStatus(authorID, postID string) {
	row, err := p.store.Get(postID)
	if err != nil || row == nil {
		return
	}
	raw, err := json.Marshal(p.publicStatus(row))
	if err != nil {
		return
	}
	p.API.PublishWebSocketEvent(wsEvent, map[string]interface{}{
		"post_id": postID,
		"body":    string(raw),
	}, &model.WebsocketBroadcast{UserId: authorID})
}

func noteBelongsTo(post *model.Post, sourceID string) bool {
	if !isNotePost(post) || sourceID == "" {
		return false
	}
	if fmt.Sprint(post.GetProp(propFor)) == sourceID {
		return true
	}
	// Notes created before the source prop used the message itself as RootId.
	return post.RootId == sourceID && post.GetProp(propFor) == nil
}

func isNotePost(post *model.Post) bool {
	if post == nil || post.GetProp(propNote) == nil {
		return false
	}
	return fmt.Sprint(post.GetProp(propNote)) == "true"
}

func noteRootID(source *model.Post) string {
	if source == nil {
		return ""
	}
	if source.RootId != "" {
		return source.RootId
	}
	return source.Id
}

func noteMessageFor(channelType model.ChannelType, authorName string, read, unread []string) string {
	read = append([]string(nil), read...)
	unread = append([]string(nil), unread...)
	sort.Strings(read)
	sort.Strings(unread)
	if channelType == model.ChannelTypeDirect {
		return directNote(authorName, read, unread)
	}
	return groupedNote(read, unread)
}

func directNote(authorName string, read, unread []string) string {
	if len(read) > 0 {
		return fmt.Sprintf("%s Seen by %s.", authorName, read[0])
	}
	other := "the other person"
	if len(unread) > 0 {
		other = unread[0]
	}
	return fmt.Sprintf("%s Not yet seen by %s.", authorName, other)
}

func groupedNote(read, unread []string) string {
	var b strings.Builder
	b.WriteString("**Read**\n")
	writeNoteNames(&b, read, "No one yet")
	b.WriteString("\n\n**Not yet read**\n")
	writeNoteNames(&b, unread, "No one")
	return b.String()
}

func writeNoteNames(b *strings.Builder, names []string, empty string) {
	if len(names) == 0 {
		b.WriteString(empty)
		return
	}
	for i, name := range names {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(name)
	}
}

func seenAtMillis(row *receiptRow) int64 {
	if row == nil {
		return 0
	}
	latest := int64(0)
	for _, st := range row.States {
		if st.ReadAt > latest {
			latest = st.ReadAt
		}
	}
	if latest > 0 {
		return latest
	}
	return row.CreateAt
}
