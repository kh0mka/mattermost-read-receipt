package main

import (
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestEvaluateSeenWhenViewedAtOrAfterCreate(t *testing.T) {
	prev := map[string]recipientState{
		"bob": {},
	}
	status, next, changed := evaluate("ann", 1000, []memberView{
		{UserID: "ann", LastViewedAt: 5000},
		{UserID: "bob", LastViewedAt: 1000},
	}, prev)
	if !changed || status != statusRead {
		t.Fatalf("status=%s changed=%v", status, changed)
	}
	if next["bob"].ReadAt != 1000 {
		t.Fatalf("read_at=%d", next["bob"].ReadAt)
	}
}

func TestEvaluatePartialAndNoBackwardRead(t *testing.T) {
	prev := map[string]recipientState{
		"bob": {ReadAt: 1500, LastViewedAt: 1500},
		"cara": {},
	}
	status, next, changed := evaluate("ann", 1000, []memberView{
		{UserID: "bob", LastViewedAt: 200},
		{UserID: "cara", LastViewedAt: 900},
	}, prev)
	if status != statusPartial {
		t.Fatalf("status=%s", status)
	}
	if next["bob"].ReadAt != 1500 {
		t.Fatalf("read moved backward to %d", next["bob"].ReadAt)
	}
	if !changed {
		t.Fatal("expected last_viewed_at update")
	}
	if next["cara"].ReadAt != 0 {
		t.Fatalf("cara read_at=%d", next["cara"].ReadAt)
	}
}

func TestEvaluatePending(t *testing.T) {
	status, _, changed := evaluate("ann", 5000, []memberView{
		{UserID: "bob", LastViewedAt: 1000},
	}, map[string]recipientState{"bob": {LastViewedAt: 1000}})
	if status != statusPending || changed {
		t.Fatalf("status=%s changed=%v", status, changed)
	}
}

func TestEvaluateDropsDepartedMember(t *testing.T) {
	prev := map[string]recipientState{
		"bob":  {ReadAt: 1500, LastViewedAt: 1500},
		"left": {},
	}
	status, next, changed := evaluate("ann", 1000, []memberView{
		{UserID: "bob", LastViewedAt: 1500},
	}, prev)
	if _, ok := next["left"]; ok {
		t.Fatal("departed member still counted")
	}
	if status != statusRead || !changed {
		t.Fatalf("status=%s changed=%v", status, changed)
	}
}

func TestSkipChannelReceipt(t *testing.T) {
	ids := make([]string, 0, channelRecipientCap+1)
	ids = append(ids, "author")
	for i := 0; i < channelRecipientCap; i++ {
		ids = append(ids, "u")
	}
	if skipChannelReceipt(model.ChannelTypeOpen, ids, "author", false) {
		t.Fatal("cap includes the author, so 50 other members stay under the cap")
	}
	ids = append(ids, "extra")
	if !skipChannelReceipt(model.ChannelTypePrivate, ids, "author", false) {
		t.Fatal("51 other members exceed the cap")
	}
	if !skipChannelReceipt(model.ChannelTypeOpen, []string{"author", "a"}, "author", true) {
		t.Fatal("a full member page is skipped so a truncated list cannot mean everyone")
	}
	if skipChannelReceipt(model.ChannelTypeGroup, ids, "author", true) {
		t.Fatal("group messages are not capped")
	}
	if skipChannelReceipt(model.ChannelTypeDirect, ids, "author", true) {
		t.Fatal("direct messages are not capped")
	}
}

func TestNoteMessageHasNoZoneLabel(t *testing.T) {
	msg := noteMessage("@ravi", []string{"@mani"})
	if strings.Contains(msg, "UTC") || strings.Contains(msg, " at ") {
		t.Fatalf("note bakes a clock time: %s", msg)
	}
	if msg != "@ravi Seen by @mani." {
		t.Fatalf("msg=%s", msg)
	}
	row := &receiptRow{CreateAt: 10, States: map[string]recipientState{
		"mani": {ReadAt: 20},
		"sam":  {ReadAt: 30},
	}}
	if seenAtMillis(row) != 30 {
		t.Fatalf("seen=%d", seenAtMillis(row))
	}
}
