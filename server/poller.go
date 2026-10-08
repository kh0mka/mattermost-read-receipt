package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
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
	status, states, changed := evaluate(row.AuthorID, row.CreateAt, members, row.States)
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
	if status == statusRead && prev != statusRead {
		p.maybePublicNote(row)
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

func (p *ReadReceiptPlugin) maybePublicNote(row *receiptRow) {
	if row == nil || row.PublicNoteAt > 0 || !p.getConfiguration().PostPublicReceiptOnRead {
		return
	}
	names := p.recipientLabels(row)
	if len(names) == 0 {
		return
	}
	author, _ := p.API.GetUser(row.AuthorID)
	authorName := "@unknown"
	if author != nil && author.Username != "" {
		authorName = "@" + author.Username
	}
	msg := noteMessage(authorName, names)
	post := &model.Post{
		UserId:    row.AuthorID,
		ChannelId: row.ChannelID,
		RootId:    row.PostID,
		Message:   msg,
	}
	post.AddProp(propNote, "true")
	post.AddProp(propSeenAt, strconv.FormatInt(seenAtMillis(row), 10))
	if _, appErr := p.API.CreatePost(post); appErr != nil {
		p.API.LogWarn("read-receipt public note failed", "err", appErr.Error(), "post_id", row.PostID)
		return
	}
	row.PublicNoteAt = time.Now().UnixMilli()
	_ = p.store.SaveState(row.PostID, row.Status, row.States, row.PublicNoteAt)
}

func (p *ReadReceiptPlugin) recipientLabels(row *receiptRow) []string {
	var names []string
	for id, st := range row.States {
		if st.ReadAt == 0 {
			continue
		}
		u, appErr := p.API.GetUser(id)
		if appErr != nil || u == nil {
			names = append(names, "@unknown")
			continue
		}
		names = append(names, "@"+u.Username)
	}
	sort.Strings(names)
	return names
}

func noteMessage(authorName string, names []string) string {
	return fmt.Sprintf("%s Seen by %s.", authorName, joinLabels(names))
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

func joinLabels(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	default:
		return strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1]
	}
}
