package httpapi

import "testing"

func TestRemotionMotionPlanToolUsesPluginCapabilities(t *testing.T) {
	capabilities := map[string]any{
		"motion": map[string]any{
			"textEntrance":     []any{map[string]any{"id": "custom-entrance"}},
			"textEmphasis":     []any{map[string]any{"id": "custom-emphasis"}},
			"imageMotion":      []any{map[string]any{"id": "custom-motion"}},
			"imageTransition":  []any{map[string]any{"id": "custom-image-transition"}},
			"sceneTransition":  []any{map[string]any{"id": "custom-scene-transition"}},
			"captionAnimation": []any{map[string]any{"id": "custom-caption"}},
		},
		"textPositions": []any{"custom-position"},
	}
	tool, err := remotionMotionPlanTool(capabilities)
	if err != nil {
		t.Fatalf("build motion plan tool: %v", err)
	}
	parameters := objectValue(tool["parameters"])
	sceneItems := objectValue(objectValue(objectValue(parameters["properties"])["scenes"])["items"])
	properties := objectValue(sceneItems["properties"])
	textProperties := objectValue(objectValue(properties["text"])["properties"])
	titleEntrance := stringSlice(objectValue(textProperties["titleEntrance"])["enum"])
	if len(titleEntrance) != 1 || titleEntrance[0] != "custom-entrance" {
		t.Fatalf("title entrance enum = %#v", titleEntrance)
	}
	if pattern := stringValue(objectValue(textProperties["titleColor"]), "pattern"); pattern != "^#[0-9A-Fa-f]{6}$" {
		t.Fatalf("title color pattern = %q", pattern)
	}
	layoutProperties := objectValue(objectValue(properties["layout"])["properties"])
	titlePosition := stringSlice(objectValue(layoutProperties["titlePosition"])["enum"])
	if len(titlePosition) != 1 || titlePosition[0] != "custom-position" {
		t.Fatalf("title position enum = %#v", titlePosition)
	}
}

func TestRemotionMotionPlanToolRejectsIncompleteCapabilities(t *testing.T) {
	if _, err := remotionMotionPlanTool(map[string]any{}); err == nil {
		t.Fatal("expected incomplete capabilities to be rejected")
	}
}
