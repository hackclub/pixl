extends Node
## Visual walkthrough of the full arrival flow (mock, no server / browser). Run:
##   godot --path . res://tests/onboarding_demo.tscn
## Cinematic → Pixo greeting → naming → experience → the loop → first Trial.
## The hand-off is mocked, so at the end it just prints what it would open.

func _ready() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.10, 0.08, 0.06)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var hint := Label.new()
	hint.text = "arrival demo - E / click / space to advance, Esc to skip the cinematic"
	hint.set_anchors_preset(Control.PRESET_CENTER_TOP)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.position.y = 24
	add_child(hint)

	var O = load("res://scripts/onboarding.gd").new()
	O.mock = true
	add_child(O)
	O.finished.connect(func():
		hint.text = "arrival complete - would open: /%s" % O.handoff_path
		print("[demo] onboarding finished. handoff=", O.handoff_path,
			" name=", O.captured_name, " experience=", O.captured_experience))
	O.start()
