package vod

import "testing"

func TestNormalizeLocations(t *testing.T) {
	values, err := normalizeLocations([]Location{{TopLeftX: 0.1, TopLeftY: 0.2, BottomRightX: 0.8, BottomRightY: 0.9}})
	if err != nil || len(values) != 1 {
		t.Fatalf("normalize valid location: values=%+v err=%v", values, err)
	}
	if _, err := normalizeLocations([]Location{{TopLeftX: 0.8, TopLeftY: 0, BottomRightX: 0.2, BottomRightY: 1}}); err == nil {
		t.Fatal("expected invalid location error")
	}
}

func TestNormalizeClips(t *testing.T) {
	if values, err := normalizeClips(nil, "all"); err != nil || values != nil {
		t.Fatalf("all clips = %+v err=%v", values, err)
	}
	if _, err := normalizeClips([]Clip{{Start: 3, End: 1}}, "selected"); err == nil {
		t.Fatal("expected invalid clip error")
	}
	values, err := normalizeClips([]Clip{{Start: 1, End: 3}}, "selected")
	if err != nil || len(values) != 1 {
		t.Fatalf("normalize valid clip: values=%+v err=%v", values, err)
	}
}

func TestNormalizeTranslationTypesRequiresVoiceForFace(t *testing.T) {
	if _, err := normalizeTranslationTypes([]string{"face"}); err == nil {
		t.Fatal("expected face translation validation error")
	}
	values, err := normalizeTranslationTypes([]string{"voice", "face"})
	if err != nil || len(values) != 3 || values[0] != "subtitle" {
		t.Fatalf("unexpected translation types: values=%v err=%v", values, err)
	}
}
