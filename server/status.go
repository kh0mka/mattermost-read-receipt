package main

import "github.com/mattermost/mattermost/server/public/model"

const (
	statusPending = "pending"
	statusPartial = "partial"
	statusRead    = "read"
	statusSkipped = "skipped"
)

// channelRecipientCap is the most other members tracked on one public or
// private channel post. A larger channel is skipped so the poller does not
// walk a company-wide channel on every interval. Group messages are not capped;
// every member except the author is included.
const channelRecipientCap = 50

// noteBackfillLimit is how many recent tracked posts get a thread note when
// the mobile note switch is already on. Older posts pick up a note the next
// time their read state changes.
const noteBackfillLimit = 50

type memberView struct {
	UserID       string
	LastViewedAt int64
}

type recipientState struct {
	ReadAt       int64 `json:"read_at"`
	LastViewedAt int64 `json:"last_viewed_at"`
}

// evaluate applies channel view times to receipt state.
// Seen means LastViewedAt >= the post create time. Read times never move backward.
func evaluate(authorID string, createAt int64, members []memberView, prev map[string]recipientState) (string, map[string]recipientState, bool) {
	next := map[string]recipientState{}
	changed := false
	for _, m := range members {
		if m.UserID == "" || m.UserID == authorID {
			continue
		}
		st := prev[m.UserID]
		if m.LastViewedAt != st.LastViewedAt {
			st.LastViewedAt = m.LastViewedAt
			changed = true
		}
		if st.ReadAt == 0 && m.LastViewedAt >= createAt && createAt > 0 {
			st.ReadAt = m.LastViewedAt
			changed = true
		}
		next[m.UserID] = st
	}
	// People who left the channel are no longer part of "everyone".
	if len(next) != len(prev) {
		changed = true
	} else {
		for id := range prev {
			if _, ok := next[id]; !ok {
				changed = true
				break
			}
		}
	}
	if len(next) == 0 {
		if changed {
			return statusRead, next, true
		}
		return statusRead, next, false
	}
	seen := 0
	for _, st := range next {
		if st.ReadAt > 0 {
			seen++
		}
	}
	status := statusPending
	switch {
	case seen == 0:
		status = statusPending
	case seen == len(next):
		status = statusRead
	default:
		status = statusPartial
	}
	return status, next, changed
}

// skipChannelReceipt reports whether a public or private channel is too large
// to track. pageFull means the member page was filled to the fetch size, so
// the list may be truncated and must not be treated as everyone. Direct
// messages and group messages are never skipped.
func skipChannelReceipt(channelType model.ChannelType, memberIDs []string, authorID string, pageFull bool) bool {
	if channelType != model.ChannelTypeOpen && channelType != model.ChannelTypePrivate {
		return false
	}
	if pageFull {
		return true
	}
	n := 0
	for _, id := range memberIDs {
		if id != "" && id != authorID {
			n++
		}
	}
	return n > channelRecipientCap
}
