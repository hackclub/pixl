extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const ARROW_PATH := "res://assets/ui/trial_arrow.png"
const MARGIN := 48.0
const PULSE_SPEED := 4.0
const PULSE_AMOUNT := 0.12
const OVERHEAD_SCALE := 0.4
const OVERHEAD_OFFSET_Y := -60.0
const BOB_SPEED := 3.0
const BOB_AMOUNT := 4.0

var _root: Control
var _arrow: TextureRect
var _t := 0.0

func _ready() -> void:
	layer = 97
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.visible = false
	add_child(_root)

	var tex: Texture2D = load(ARROW_PATH) if ResourceLoader.exists(ARROW_PATH) else null
	_arrow = TextureRect.new()
	_arrow.texture = tex
	_arrow.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	_arrow.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	var sz: Vector2 = tex.get_size() if tex else Vector2(64, 64)
	_arrow.custom_minimum_size = sz
	_arrow.size = sz
	_arrow.pivot_offset = sz / 2.0
	_arrow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_arrow)

func _process(delta: float) -> void:
	_t += delta
	if _arrow.texture == null:
		var tex: Texture2D = load(ARROW_PATH) if ResourceLoader.exists(ARROW_PATH) else null
		if tex:
			_arrow.texture = tex
			_arrow.custom_minimum_size = tex.get_size()
			_arrow.size = tex.get_size()
			_arrow.pivot_offset = tex.get_size() / 2.0
		else:
			_root.visible = false
			return

	var target := _find_target()
	if target == null:
		_root.visible = false
		return

	var size := get_viewport().get_visible_rect().size
	var center := size / 2.0
	var screen_pos: Vector2 = get_viewport().canvas_transform * target.global_position
	var offset := screen_pos - center
	var half := center - Vector2(MARGIN, MARGIN)
	if absf(offset.x) <= half.x and absf(offset.y) <= half.y:
		_root.visible = true
		var head_world := target.global_position + Vector2(0, OVERHEAD_OFFSET_Y + sin(_t * BOB_SPEED) * BOB_AMOUNT)
		var head_point: Vector2 = get_viewport().canvas_transform * head_world
		_arrow.position = head_point - _arrow.pivot_offset
		_arrow.rotation = PI
		_arrow.scale = Vector2.ONE * OVERHEAD_SCALE
		return

	_root.visible = true
	var dir := offset.normalized()
	var scale_x: float = half.x / absf(dir.x) if dir.x != 0.0 else INF
	var scale_y: float = half.y / absf(dir.y) if dir.y != 0.0 else INF
	var edge_pos := center + dir * minf(scale_x, scale_y)
	_arrow.position = edge_pos - _arrow.pivot_offset
	_arrow.rotation = dir.angle() + PI / 2.0
	_arrow.scale = Vector2.ONE * (1.0 + sin(_t * PULSE_SPEED) * PULSE_AMOUNT)

func _find_target() -> Node2D:
	var cur := get_tree().current_scene
	if cur == null or not GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename()):
		return null
	if global.ui_blocked() or Dialogue.is_open or NetworkManager.session_token == "":
		return null
	if not "_local_player" in cur:
		return null
	var me = cur.get("_local_player")
	if me == null or not is_instance_valid(me):
		return null
	var best: Node2D = null
	var best_dist := INF
	for child in cur.get_children():
		if not (child is CharacterBody2D and child.has_method("npc_id")):
			continue
		if child.get("quest_trial") != true or not child.visible:
			continue
		var d: float = me.global_position.distance_squared_to(child.global_position)
		if d < best_dist:
			best_dist = d
			best = child
	return best
