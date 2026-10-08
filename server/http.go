package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (p *ReadReceiptPlugin) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	p.writeAuthorStatuses(w, userID, splitCSV(r.URL.Query().Get("post_ids")), false)
}

func (p *ReadReceiptPlugin) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		PostIDs []string `json:"post_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p.writeAuthorStatuses(w, userID, body.PostIDs, true)
}

func (p *ReadReceiptPlugin) writeAuthorStatuses(w http.ResponseWriter, userID string, ids []string, refresh bool) {
	if len(ids) > 50 {
		ids = ids[:50]
	}
	posts := map[string]any{}
	for _, id := range ids {
		row, err := p.store.Get(id)
		if err != nil || row == nil || row.AuthorID != userID {
			continue
		}
		if refresh {
			p.refreshOne(row)
			reloaded, reloadErr := p.store.Get(id)
			if reloadErr != nil || reloaded == nil {
				continue
			}
			row = reloaded
		}
		posts[id] = p.publicStatus(row)
	}
	p.writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

func (p *ReadReceiptPlugin) publicStatus(row *receiptRow) map[string]any {
	channelType := ""
	if ch, appErr := p.API.GetChannel(row.ChannelID); appErr == nil && ch != nil {
		channelType = string(ch.Type)
	}
	recipients := make([]map[string]any, 0, len(row.States))
	for id, st := range row.States {
		username := ""
		display := ""
		if u, appErr := p.API.GetUser(id); appErr == nil && u != nil {
			username = u.Username
			display = strings.TrimSpace(u.FirstName + " " + u.LastName)
			if display == "" {
				display = username
			}
		}
		recipients = append(recipients, map[string]any{
			"user_id":      id,
			"username":     username,
			"display_name": display,
			"seen_at":      st.ReadAt,
			"delivered_at": row.CreateAt,
		})
	}
	return map[string]any{
		"status":       row.Status,
		"create_at":    row.CreateAt,
		"channel_type": channelType,
		"recipients":   recipients,
	}
}
