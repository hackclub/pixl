extends CanvasLayer
## Opening cinematic, the Day-0 arrival. A sequence of full-screen illustrated
## panels (see ONBOARDING_REDESIGN.md §3 for why panels over web video): each
## panel fades in, its caption lines type on, it holds, then auto-advances.
## Skippable and replayable. Emits `finished` when the last panel completes or
## the player skips, the caller then loads the village (arrival mode).
##
## Art: PANELS[].texture is null on beats without art yet (currently THE GREAT
## STATIC), which render as a tinted placeholder with the title instead. Drop a
## Texture2D per beat in to fill the rest. A hidden VideoStreamPlayer is
## reserved so a pre-rendered cut can drop in over the panels without touching
## the flow.

signal finished

# One entry per beat: tint (placeholder bg / caption glow), optional texture,
# caption lines (typed in sequence), and how long to hold after the last line
# before auto-advancing. Copy is final (ONBOARDING_REDESIGN.md §3).
const PANELS := [
	{
		"title": "ORIGIN",
		"tint": Color(0.98, 0.78, 0.35),
		"texture": preload("res://assets/cinematic/origin.png"),
		"lines": [
			"Once, there was Origin, the brightest world the machine ever dreamed.",
			"Every idea ever built flowed into one place: the Core.",
		],
		"hold": 1.6,
	},
	{
		"title": "OVERLOAD",
		"tint": Color(0.9, 0.42, 0.2),
		"texture": preload("res://assets/cinematic/overload.png"),
		"lines": [
			"For centuries it held every invention. Every blueprint. Every spark.",
			"Until it held too much.",
		],
		"hold": 1.4,
	},
	{
		"title": "THE GREAT STATIC",
		"tint": Color(0.85, 0.86, 0.9),
		"texture": null,
		"lines": [
			"Then came the Great Static.",
			"In one surge, Origin shattered into a thousand islands, adrift in the Void.",
		],
		"hold": 1.2,
	},
	{
		"title": "THE LAST SPACECRAFT",
		"tint": Color(0.4, 0.5, 0.78),
		"texture": preload("res://assets/cinematic/last_spacecraft.png"),
		"lines": [
			"The survivors couldn't rebuild alone. So they crossed the Void looking for help,",
			"and found a small blue planet full of people who build things for fun.",
			"They found you.",
		],
		"hold": 1.6,
	},
	{
		"title": "ARRIVAL",
		"tint": Color(0.96, 0.72, 0.4),
		"texture": preload("res://assets/cinematic/arrival.png"),
		"lines": [
			"They call this place Pixl now.",
			"What's left of it is waiting.",
		],
		"hold": 1.8,
	},
]

const FONT := preload("res://assets/fonts/PixelifySans.ttf")
const TYPE_CPS := 42.0

var _panel := -1
var _line := 0
var _lines: PackedStringArray = PackedStringArray()
var _typing := false
var _type_len := 0
var _done := false
var _standalone := false

var _bg: ColorRect
var _art: TextureRect
var _static_fx: ColorRect
var _video: VideoStreamPlayer
var _title: Label
var _caption: Label
var _skip_hint: Label

func _ready() -> void:
	layer = 120
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	# Run directly (F6 / godot res://scenes/intro_cinematic.tscn) → self-drive
	# and quit at the end. Embedded (instantiated by onboarding) → wait for play().
	if get_tree().current_scene == self:
		_standalone = true
		finished.connect(func(): get_tree().quit())
		play()

func _build_ui() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.gui_input.connect(_on_root_gui_input)  # tap-to-advance, mobile has no [E]
	add_child(root)

	_bg = ColorRect.new()
	_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_bg.color = Color(0.02, 0.02, 0.03)
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE  # was STOP by default, ate every click before root's gui_input saw it
	root.add_child(_bg)

	# Reserved slot for a future pre-rendered cut, inert (no stream) for now.
	_video = VideoStreamPlayer.new()
	_video.set_anchors_preset(Control.PRESET_FULL_RECT)
	_video.expand = true
	_video.visible = false
	root.add_child(_video)

	_art = TextureRect.new()
	_art.set_anchors_preset(Control.PRESET_FULL_RECT)
	_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_art.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_art)

	_static_fx = ColorRect.new()
	_static_fx.set_anchors_preset(Control.PRESET_FULL_RECT)
	_static_fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_static_fx.visible = false
	_static_fx.material = ShaderMaterial.new()
	_static_fx.material.shader = preload("res://shaders/tv_static.gdshader")
	root.add_child(_static_fx)

	# Placeholder title, centred, big - stands in for the art until stills exist.
	_title = Label.new()
	_title.set_anchors_preset(Control.PRESET_CENTER)
	_title.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_title.grow_vertical = Control.GROW_DIRECTION_BOTH
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.add_theme_font_override("font", FONT)
	_title.add_theme_font_size_override("font_size", 80)
	_title.add_theme_color_override("font_color", Color(1, 1, 1, 0.16))
	root.add_child(_title)

	# Caption plate along the bottom.
	var plate := ColorRect.new()
	plate.color = Color(0, 0, 0, 0.55)
	plate.anchor_top = 1.0
	plate.anchor_bottom = 1.0
	plate.anchor_right = 1.0
	plate.offset_top = -190
	plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(plate)

	_caption = Label.new()
	_caption.anchor_top = 1.0
	_caption.anchor_bottom = 1.0
	_caption.anchor_right = 1.0
	_caption.offset_top = -150
	_caption.offset_left = 80
	_caption.offset_right = -80
	_caption.offset_bottom = -60
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_caption.add_theme_font_override("font", FONT)
	_caption.add_theme_font_size_override("font_size", 30)
	_caption.add_theme_color_override("font_color", Color(0.98, 0.94, 0.85))
	root.add_child(_caption)

	_skip_hint = Label.new()
	_skip_hint.text = "[Esc] skip   ·   [E] / click to continue"
	_skip_hint.anchor_left = 1.0
	_skip_hint.anchor_right = 1.0
	_skip_hint.anchor_top = 1.0
	_skip_hint.anchor_bottom = 1.0
	_skip_hint.offset_left = -360
	_skip_hint.offset_top = -34
	_skip_hint.offset_right = -16
	_skip_hint.offset_bottom = -10
	_skip_hint.add_theme_font_override("font", FONT)
	_skip_hint.add_theme_font_size_override("font_size", 15)
	_skip_hint.add_theme_color_override("font_color", Color(1, 1, 1, 0.45))
	root.add_child(_skip_hint)

## Start (or restart) the cinematic from the first panel.
func play() -> void:
	_done = false
	_panel = -1
	visible = true
	next_panel()

## Advance to the next panel, or finish after the last one.
func next_panel() -> void:
	if _done:
		return
	_panel += 1
	if _panel >= PANELS.size():
		_finish()
		return
	var p: Dictionary = PANELS[_panel]
	_static_fx.visible = String(p["title"]) == "THE GREAT STATIC"
	_art.texture = p["texture"]
	_art.visible = p["texture"] != null
	_title.text = p["title"]
	_title.visible = p["texture"] == null  # placeholder only until art exists
	_lines = PackedStringArray(p["lines"])
	_line = -1
	# Fade the tint plate in for this beat.
	_bg.color = Color(p["tint"], 1.0).darkened(0.86)
	var fade := create_tween()
	_bg.modulate.a = 0.0
	fade.tween_property(_bg, "modulate:a", 1.0, 0.4)
	_next_line()

func _next_line() -> void:
	_line += 1
	if _line >= _lines.size():
		return
	_caption.text = _lines[_line]
	_type_len = _caption.text.length()
	_caption.visible_characters = 0
	_typing = _type_len > 0

# [E]/click: snap a still-typing line to full first; otherwise advance to the
# next line (or panel). Player-driven, nothing auto-advances.
func _advance() -> void:
	if _done:
		return
	if _typing:
		_typing = false
		_caption.visible_characters = _type_len
		return
	if _line >= _lines.size() - 1:
		next_panel()
	else:
		_next_line()

func skip() -> void:
	_finish()

func _finish() -> void:
	if _done:
		return
	_done = true
	_static_fx.visible = false
	visible = false
	finished.emit()

func _process(delta: float) -> void:
	# Only drives the typewriter reveal; advancing a finished line waits for the
	# player ([E]/click/space), see _advance / _unhandled_input.
	if _done or not _typing:
		return
	_caption.visible_characters = mini(
		_type_len, _caption.visible_characters + int(ceil(TYPE_CPS * delta)))
	if _caption.visible_characters >= _type_len:
		_typing = false

func _unhandled_input(event: InputEvent) -> void:
	if _done:
		return
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		skip()
	elif event.is_action_pressed("interact") \
			or (event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_SPACE):
		get_viewport().set_input_as_handled()
		_advance()

# root eats clicks/taps via MOUSE_FILTER_STOP before _unhandled_input sees
# them, so this is the actual advance path for mouse/touch (touch emulates
# mouse by default - see input_devices/pointing/emulate_mouse_from_touch).
func _on_root_gui_input(event: InputEvent) -> void:
	if _done:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_advance()
