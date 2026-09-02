extends Control
## Visual smoke-test for the extended Dialogue autoload. Run windowed:
##   godot --path . res://tests/dialogue_demo.tscn
## or open the scene in the editor and press F6.
##
##   [1] play a typewriter line run  (press E to advance / snap)
##   [2] ask the experience question (click an option)
## The chosen answer is printed and shown in the on-screen log.

var _log: Label

func _ready() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.09, 0.07, 0.05)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.grow_horizontal = Control.GROW_DIRECTION_BOTH
	v.grow_vertical = Control.GROW_DIRECTION_BOTH
	v.add_theme_constant_override("separation", 14)
	add_child(v)

	var title := Label.new()
	title.text = "DIALOGUE DEMO"
	title.add_theme_font_size_override("font_size", 32)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)

	var help := Label.new()
	help.text = "[1] typewriter line run  (E advances / snaps)\n[2] ask the experience question  (click an option)"
	help.add_theme_font_size_override("font_size", 20)
	help.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(help)

	_log = Label.new()
	_log.text = "waiting…"
	_log.add_theme_font_size_override("font_size", 20)
	_log.add_theme_color_override("font_color", Color(1, 0.82, 0.4))
	_log.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_log)

	# Use the real autoloaded Dialogue singleton.
	Dialogue.chosen.connect(_on_chosen)
	Dialogue.closed.connect(func(): if not Dialogue._choosing: _log.text = "closed")

func _on_chosen(index: int, id: String) -> void:
	_log.text = "chose #%d → \"%s\"" % [index, id]
	print("[demo] chosen index=%d id=%s" % [index, id])

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_1:
		_log.text = "playing line run - press E"
		Dialogue.open("Pixo", [
			"Oh, you actually came. Good. I wasn't sure anyone would.",
			"I'm Pixo. I've kept this little Hub lit since the Static hit.",
			"First things first, though. Let's get you sorted.",
		])
	elif event.keycode == KEY_2:
		_log.text = "pick an option…"
		Dialogue.ask("Pixo",
			["One more thing, so I know how much to explain.", "How much have you built before?"],
			PackedStringArray(["I'm just starting out.", "I've shipped a few things.", "I build all the time."]),
			PackedStringArray(["beginner", "intermediate", "advanced"]))
