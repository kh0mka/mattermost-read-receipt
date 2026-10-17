package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	pluginID      = "com.mst.read-receipt"
	pluginVersion = "0.3.5"
	wsEvent       = "read_receipt_updated"
	propNote      = "mst_read_receipt_note"
	propFor       = "mst_read_receipt_for"
	propSeenAt    = "mst_read_receipt_seen_at"
)

type ReadReceiptPlugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	store *receiptStore

	stopMu sync.Mutex
	stop   chan struct{}
}

func (p *ReadReceiptPlugin) OnActivate() error {
	if err := p.OnConfigurationChange(); err != nil {
		return err
	}
	p.store = newStore(p.API)
	if _, err := p.store.conn(); err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	p.stopMu.Lock()
	if p.stop != nil {
		close(p.stop)
	}
	p.stop = make(chan struct{})
	stop := p.stop
	p.stopMu.Unlock()
	go p.pollLoop(stop)
	go p.logViewSpike()
	return nil
}

func (p *ReadReceiptPlugin) OnDeactivate() error {
	p.stopMu.Lock()
	defer p.stopMu.Unlock()
	if p.stop != nil {
		close(p.stop)
		p.stop = nil
	}
	return nil
}

func (p *ReadReceiptPlugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	path := normalizePluginHTTPPath(r.URL.Path)
	switch {
	case path == "/api/v1/health":
		p.writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": pluginVersion})
	case path == "/api/v1/status":
		p.handleStatus(w, r)
	case path == "/api/v1/refresh":
		p.handleRefresh(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *ReadReceiptPlugin) pluginRelativeURL(path string) string {
	return "/plugins/" + pluginID + path
}

func normalizePluginHTTPPath(path string) string {
	for _, prefix := range []string{"/plugins/" + pluginID, pluginID} {
		if strings.HasPrefix(path, prefix) {
			path = strings.TrimPrefix(path, prefix)
			break
		}
	}
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return path
}

func (p *ReadReceiptPlugin) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (p *ReadReceiptPlugin) MessageHasBeenPosted(_ *plugin.Context, post *model.Post) {
	if post == nil || post.Id == "" || post.UserId == "" || post.DeleteAt != 0 {
		return
	}
	if post.Type != "" {
		return
	}
	if post.GetProp(propNote) != nil {
		return
	}
	cfg := p.getConfiguration()
	channel, appErr := p.API.GetChannel(post.ChannelId)
	if appErr != nil || channel == nil {
		return
	}
	// Receipt state stays in SQLite. Updating the post to set a prop would mark it edited.
	if !shouldTrack(cfg, channel.Type) || !p.userAllowed(post.UserId) {
		return
	}
	existing, err := p.store.Get(post.Id)
	if err != nil {
		p.API.LogError("read-receipt lookup failed", "err", err.Error(), "post_id", post.Id)
		return
	}
	if existing != nil {
		return
	}
	members, skip := p.receiptMembers(post.ChannelId, post.UserId)
	if skip {
		p.API.LogInfo("read-receipt skipped channel over member cap", "post_id", post.Id, "channel_id", post.ChannelId, "cap", channelRecipientCap)
		return
	}
	states := map[string]recipientState{}
	for _, m := range members {
		if m.UserID == "" || m.UserID == post.UserId {
			continue
		}
		states[m.UserID] = recipientState{}
	}
	now := time.Now().UnixMilli()
	status, states, _ := evaluate(post.UserId, post.CreateAt, members, states, now, true)
	row := receiptRow{
		PostID:       post.Id,
		ChannelID:    post.ChannelId,
		AuthorID:     post.UserId,
		CreateAt:     post.CreateAt,
		RequestedAt:  now,
		RequestedBy:  post.UserId,
		Status:       status,
		States:       states,
		PublicNoteAt: 0,
	}
	if err := p.store.Insert(row); err != nil {
		p.API.LogError("read-receipt insert failed", "err", err.Error(), "post_id", post.Id)
		return
	}
	p.API.LogInfo("read-receipt tracking message", "post_id", post.Id, "channel_type", string(channel.Type), "status", status, "recipients", len(states))
	if status != statusPending {
		p.publishStatus(row.AuthorID, row.PostID)
	}
}

// receiptMembers loads the people who count toward "everyone has read".
// Public and private channels above channelRecipientCap are skipped.
// Group messages include every member except the author.
func (p *ReadReceiptPlugin) receiptMembers(channelID, authorID string) ([]memberView, bool) {
	ch, appErr := p.API.GetChannel(channelID)
	if appErr != nil || ch == nil {
		return nil, false
	}
	perPage := 200
	capped := ch.Type == model.ChannelTypeOpen || ch.Type == model.ChannelTypePrivate
	if capped {
		perPage = channelRecipientCap + 2
	}
	raw, appErr := p.API.GetChannelMembers(channelID, 0, perPage)
	if appErr != nil {
		p.API.LogWarn("read-receipt members failed", "err", appErr.Error(), "channel_id", channelID)
		return nil, false
	}
	members := make([]memberView, 0, len(raw))
	ids := make([]string, 0, len(raw))
	for _, m := range raw {
		members = append(members, memberView{UserID: m.UserId, LastViewedAt: m.LastViewedAt})
		ids = append(ids, m.UserId)
	}
	pageFull := capped && len(raw) >= perPage
	if skipChannelReceipt(ch.Type, ids, authorID, pageFull) {
		return nil, true
	}
	return members, false
}

func (p *ReadReceiptPlugin) memberViews(channelID string) []memberView {
	members, appErr := p.API.GetChannelMembers(channelID, 0, 200)
	if appErr != nil {
		p.API.LogWarn("read-receipt members failed", "err", appErr.Error(), "channel_id", channelID)
		return nil
	}
	out := make([]memberView, 0, len(members))
	for _, m := range members {
		out = append(out, memberView{UserID: m.UserId, LastViewedAt: m.LastViewedAt})
	}
	return out
}

// logViewSpike records plugin-API LastViewedAt for one direct channel.
// REST hides this field for other users. A non-zero value here means the poller can see it.
func (p *ReadReceiptPlugin) logViewSpike() {
	defer func() {
		if r := recover(); r != nil {
			p.API.LogError("read-receipt spike panic", "recover", fmt.Sprint(r))
		}
	}()
	admins, appErr := p.API.GetUsers(&model.UserGetOptions{
		Role:    "system_admin",
		Active:  true,
		Page:    0,
		PerPage: 1,
	})
	if appErr != nil || len(admins) == 0 || admins[0] == nil {
		p.API.LogWarn("read-receipt spike skipped", "reason", "no system admin")
		return
	}
	teams, appErr := p.API.GetTeams()
	if appErr != nil || len(teams) == 0 {
		p.API.LogWarn("read-receipt spike skipped", "reason", "no team")
		return
	}
	var channels []*model.Channel
	for _, team := range teams {
		if team == nil {
			continue
		}
		found, teamErr := p.API.GetChannelsForTeamForUser(team.Id, admins[0].Id, false)
		if teamErr != nil {
			p.API.LogWarn("read-receipt spike channels failed", "err", teamErr.Error(), "team_id", team.Id)
			continue
		}
		channels = append(channels, found...)
	}
	scanned := 0
	for _, ch := range channels {
		if ch == nil || ch.Type != model.ChannelTypeDirect {
			continue
		}
		scanned++
		members, appErr := p.API.GetChannelMembers(ch.Id, 0, 10)
		if appErr != nil {
			p.API.LogWarn("read-receipt spike members failed", "err", appErr.Error())
			continue
		}
		if len(members) < 2 {
			continue
		}
		nonzero := 0
		for _, m := range members {
			if m.LastViewedAt > 0 {
				nonzero++
			}
		}
		if nonzero == 0 {
			continue
		}
		for _, m := range members {
			p.API.LogInfo("read-receipt spike", "channel_id", ch.Id, "user_id", m.UserId, "last_viewed_at", m.LastViewedAt)
		}
		p.API.LogInfo("read-receipt spike ok", "members", len(members), "nonzero_members", nonzero)
		return
	}
	p.API.LogWarn("read-receipt spike skipped", "reason", "no direct channel with a view time", "direct_channels", scanned)
}
