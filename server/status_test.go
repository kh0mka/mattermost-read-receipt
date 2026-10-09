package main

import (
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestReadLaterStoresObservationTime(t *testing.T) {
	prev := map[string]recipientState{
		"bob": {LastViewedAt: 500},
	}
	// LastViewedAt stuck at the post time must not become the Seen clock.
	status, next, changed := evaluate("ann", 1000, []memberView{
		{UserID: "ann", LastViewedAt: 5000},
		{UserID: "bob", LastViewedAt: 1000},
	}, prev, 90000, false)
	if !changed || status != statusRead {
		t.Fatalf("status=%s changed=%v", status, changed)
	}
	if next["bob"].ReadAt != 90000 {
		t.Fatalf("read_at=%d", next["bob"].ReadAt)
	}
	if next["bob"].ReadAt <= 1000 {
		t.Fatal("later read stored the delivery time")
	}
}

func TestImmediateViewCanMatchCreate(t *testing.T) {
	status, next, changed := evaluate("ann", 1000, []memberView{
		{UserID: "bob", LastViewedAt: 5000},
	}, map[string]recipientState{"bob": {}}, 1100, true)
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
	}, prev, 5000, false)
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
	}, map[string]recipientState{"bob": {LastViewedAt: 1000}}, 6000, false)
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
	}, prev, 4000, false)
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

func TestNoteRootUsesThreadRoot(t *testing.T) {
	root := &model.Post{Id: "root"}
	if noteRootID(root) != "root" {
		t.Fatalf("root=%s", noteRootID(root))
	}
	reply := &model.Post{Id: "reply", RootId: "root"}
	if noteRootID(reply) != "root" {
		t.Fatalf("reply=%s", noteRootID(reply))
	}
	note := &model.Post{Id: "note", RootId: "root"}
	note.AddProp(propNote, "true")
	note.AddProp(propFor, "reply")
	if !noteBelongsTo(note, "reply") || noteBelongsTo(note, "other") {
		t.Fatal("source prop did not select the note")
	}
}

func TestNoteMessageHasNoZoneLabel(t *testing.T) {
	seen := noteMessageFor(model.ChannelTypeDirect, "@ravi", []string{"@mani"}, nil)
	if strings.Contains(seen, "UTC") || strings.Contains(seen, " at ") {
		t.Fatalf("note bakes a clock time: %s", seen)
	}
	if seen != "@ravi Seen by @mani." {
		t.Fatalf("msg=%s", seen)
	}
	pending := noteMessageFor(model.ChannelTypeDirect, "@ravi", nil, []string{"@mani"})
	if pending != "@ravi Not yet seen by @mani." || strings.Contains(pending, "UTC") || strings.Contains(pending, ":") {
		t.Fatalf("pending=%s", pending)
	}
	grouped := noteMessageFor(model.ChannelTypeOpen, "@ravi", []string{"@sam", "@mani"}, []string{"@zia"})
	if strings.Contains(grouped, "UTC") || strings.Contains(grouped, " at ") || strings.Contains(grouped, ":") {
		t.Fatalf("grouped bakes a clock: %s", grouped)
	}
	if !strings.Contains(grouped, "**Read**") || !strings.Contains(grouped, "**Not yet read**") {
		t.Fatalf("grouped=%s", grouped)
	}
	if !strings.Contains(grouped, "@mani") || !strings.Contains(grouped, "@sam") || !strings.Contains(grouped, "@zia") {
		t.Fatalf("grouped=%s", grouped)
	}
	if strings.Index(grouped, "@mani") > strings.Index(grouped, "@sam") {
		t.Fatalf("expected sorted names: %s", grouped)
	}
	gm := noteMessageFor(model.ChannelTypeGroup, "@ravi", nil, []string{"@sam"})
	if !strings.Contains(gm, "**Not yet read**") || strings.Contains(gm, "Seen by") {
		t.Fatalf("group=%s", gm)
	}
	unknown := noteMessageFor("", "@ravi", []string{"@a"}, []string{"@b"})
	if strings.Contains(unknown, "Seen by") || !strings.Contains(unknown, "**Read**") || !strings.Contains(unknown, "@b") {
		t.Fatalf("missing channel type must stay a member list: %s", unknown)
	}
	row := &receiptRow{CreateAt: 10, States: map[string]recipientState{
		"mani": {ReadAt: 20},
		"sam":  {ReadAt: 30},
	}}
	if seenAtMillis(row) != 30 {
		t.Fatalf("seen=%d", seenAtMillis(row))
	}
}
