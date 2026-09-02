extends Control
## Logic for the "Customise your look" screen. The UI lives in
## character_editor.tscn, this script just wires the nodes and applies the
## chosen skin (sent to the server, which persists and broadcasts it). Done
## returns to whichever scene opened the editor.

# Each stepper row is %<part>Stepper with children [NameLabel, Dec, Value, Inc].
@onready var _steppers := {
	"body": %SkinStepper,
	"hair": %HairStepper,
	"top": %TopStepper,
	"bottom": %BottomStepper,
}
@onready var _maxes := {
	"body": SkinUtil.NUM_BODY,
	"hair": SkinUtil.NUM_HAIR,
	"top": SkinUtil.NUM_TOP,
	"bottom": SkinUtil.NUM_BOTTOM,
}

var _value_labels: Dictionary = {}
var _preset_buttons: Array[TextureButton] = []

# Current outfit (used when not on a preset) and the selected preset (0 = none).
var _body := 1
var _hair := 1
var _top := 1
var _bottom := 1
var _preset := 1

# Main menu & pause menu keep the original Monocraft face; the rest of the game
# moved its default menu font to Pixelify Sans (see commit b8b1360). This menu
# is reached straight from the main menu, so it keeps Monocraft too.
const OLD_MENU_FONT := preload("res://assets/fonts/Monocraft.ttf")

func _ready() -> void:
	# Duplicate first so we don't mutate the shared theme resource other menus use.
	theme = theme.duplicate(true)
	theme.default_font = OLD_MENU_FONT

	for part in _steppers:
		var row: Control = _steppers[part]
		var maxv: int = _maxes[part]
		(row.get_node("Dec") as Button).pressed.connect(_on_step.bind(part, -1, maxv))
		(row.get_node("Inc") as Button).pressed.connect(_on_step.bind(part, 1, maxv))
		_value_labels[part] = row.get_node("Value")

	# Preset thumbnails are assigned in the scene; here we just wire them up.
	var n := 1
	for child in %PresetGrid.find_children("", "TextureButton", true, false):
		child.pressed.connect(_on_pick_preset.bind(n))
		_preset_buttons.append(child)
		n += 1

	%RandomButton.pressed.connect(_on_random)
	%DoneButton.pressed.connect(_on_done)

	_load_from(NetworkManager.local_skin)
	_refresh()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		_on_done()

func _load_from(desc: String) -> void:
	var o := SkinUtil.parse_outfit(desc)
	_body = o.body
	_hair = o.hair
	_top = o.top
	_bottom = o.bottom
	_preset = SkinUtil.preset_index(desc)  # 0 if this is an outfit

func _current_desc() -> String:
	if _preset > 0:
		return "cvc:%d" % _preset
	return SkinUtil.encode_outfit(_body, _hair, _top, _bottom)

func _on_step(part: String, delta: int, maxv: int) -> void:
	# Touching a stepper drops out of preset mode into the layered outfit.
	_preset = 0
	var v: int = _get_part(part) + delta
	if v < 1:
		v = maxv
	elif v > maxv:
		v = 1
	_set_part(part, v)
	_apply()

func _on_pick_preset(n: int) -> void:
	_preset = n
	_apply()

func _on_random() -> void:
	_load_from(SkinUtil.random_outfit())
	_preset = 0
	_apply()

func _on_done() -> void:
	var target := global.editor_return_scene
	# World scenes wait on a server round-trip before the player spawns, so cover
	# the gap with the loading overlay (they hide it once spawned). The menu has
	# nothing to wait on, so it just switches instantly.
	if target.ends_with("village.tscn"):
		Loader.change_scene(target, "Entering village")
	elif target.ends_with("open_world.tscn"):
		Loader.change_scene(target, "Joining open-world")
	else:
		get_tree().change_scene_to_file(target)

func _get_part(part: String) -> int:
	match part:
		"body": return _body
		"hair": return _hair
		"top": return _top
		_: return _bottom

func _set_part(part: String, v: int) -> void:
	match part:
		"body": _body = v
		"hair": _hair = v
		"top": _top = v
		"bottom": _bottom = v

func _apply() -> void:
	NetworkManager.send_set_skin(_current_desc())
	_refresh()

func _refresh() -> void:
	_value_labels["body"].text = "%d / %d" % [_body, SkinUtil.NUM_BODY]
	_value_labels["hair"].text = "%d / %d" % [_hair, SkinUtil.NUM_HAIR]
	_value_labels["top"].text = "%d / %d" % [_top, SkinUtil.NUM_TOP]
	_value_labels["bottom"].text = "%d / %d" % [_bottom, SkinUtil.NUM_BOTTOM]
	%Preview.texture = SkinUtil.portrait(_current_desc())
	for i in _preset_buttons.size():
		_preset_buttons[i].modulate = Color.WHITE if (i + 1) == _preset else Color(0.5, 0.5, 0.5, 1.0)
