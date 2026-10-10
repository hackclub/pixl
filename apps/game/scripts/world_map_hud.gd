extends CanvasLayer

const MAP_FRAME := preload("res://assets/ui/map_frame.png")
const MAP_FRAME_TOP := preload("res://assets/ui/map_frame_top.png")
const FRAME_SIZE := Vector2(1392, 816)
const BEZEL_RECT := Rect2(80, 164, 1228, 560)
const BEZEL_STEP := 4.0
const COLOR_BEZEL_OUTLINE := Color(0.141176, 0.101961, 0.090196)
const COLOR_BEZEL_RIM := Color(0.85098, 0.72549, 0.580392)
const COLOR_BEZEL_SHADOW := Color(0.141176, 0.101961, 0.090196)
const MAP_RECT := Rect2(BEZEL_RECT.position + Vector2(8, 8), BEZEL_RECT.size - Vector2(16, 16))
const MONOCRAFT := preload("res://assets/fonts/Monocraft.ttf")

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const COLOR_ACCENT := Color(1, 0.819608, 0.4)
const COLOR_DIM := Color(0.788235, 0.694118, 0.54902)
const COLOR_MARKER := Color(1, 0.85, 0.1)
const COLOR_SEA := Color(0.309804, 0.643137, 0.721569)
const COLOR_INK := Color(0.121569, 0.098039, 0.070588)
const COLOR_ROUTE := Color(1, 0.85, 0.55, 0.4)

# Region name (must match sidequests.region in the dashboard) -> where it sits in
# WORLD coordinates, per map. These used to be fractions of the panel eyeballed
# against the old flat placeholder, which put every label on the wrong island
# once the terrain bake replaced it; running them through the bake's bounds keeps
# them on their region no matter how the world is re-baked.
const REGION_POINTS := {
	"open_world": {
		"The Hub": Vector2(-164, -322),
		"Dustline": Vector2(-950, 627),
		"Pixlcraft": Vector2(408, 696),
		"Factory Island": Vector2(-1030, -198),
		"Pixl Cafe": Vector2(786, -190),
	},
	"village": {
		"The Hub": Vector2(-136, -104),
	},
}

# Which regions a boat actually links. Drawn as dashed sailing routes so the
# ocean between the islands reads as somewhere you can go rather than dead space.
const ROUTES := [
	["The Hub", "Dustline"],
	["The Hub", "Pixlcraft"],
	["Pixlcraft", "Dustline"],
	["The Hub", "Factory Island"],
	["The Hub", "Pixl Cafe"],
]

# Interiors (house/shop) are rooms inside the overworld and have no bake of
# their own, so they fall back to it. The village does have its own bake, so
# standing in it shows the village rather than the overworld it sits in.
const FALLBACK_MAP_KEY := "open_world"

func _map_key() -> String:
	var cur := get_tree().current_scene
	if cur == null:
		return FALLBACK_MAP_KEY
	var key := MapData.scene_key(cur)
	return key if MapData.has(key) else FALLBACK_MAP_KEY
const COLOR_SELF := Color(1, 0.819608, 0.4)

var _root: Control
var _map_panel: Control
var _map_art: Control
var _detail_panel: PanelContainer
var _detail_title: Label
var _detail_body: RichTextLabel
var _hotspots: Dictionary = {}
var _markers: Dictionary = {}
var _open := false
var _quests_by_region: Dictionary = {}

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_M:
		if ChatHud.is_typing() or Dialogue.is_open or (not _open and global.ui_blocked()):
			return
		_toggle()
		get_viewport().set_input_as_handled()
	elif _open and event.keycode == KEY_ESCAPE:
		close()
		get_viewport().set_input_as_handled()

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current and GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func is_open() -> bool:
	return _open

func open() -> void:
	if _open:
		return
	_open = true
	global.push_ui_blocker()
	_root.visible = true
	_detail_panel.visible = false
	# The map is modal and blocks movement, so one redraw on open is enough to
	# keep the "you are here" dot honest.
	_layout_hotspots()
	_map_art.queue_redraw()
	_refresh_markers()

func close() -> void:
	if not _open:
		return
	_open = false
	global.pop_ui_blocker()
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.78)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var frame := TextureRect.new()
	frame.texture = MAP_FRAME
	frame.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	frame.custom_minimum_size = FRAME_SIZE
	center.add_child(frame)

	var bezel := Control.new()
	bezel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bezel.draw.connect(func():
		bezel.draw_rect(BEZEL_RECT, COLOR_BEZEL_OUTLINE)
		bezel.draw_rect(BEZEL_RECT.grow(-BEZEL_STEP), COLOR_BEZEL_RIM)
	)
	frame.add_child(bezel)

	_map_panel = Control.new()
	_map_panel.position = MAP_RECT.position
	_map_panel.size = MAP_RECT.size
	_map_panel.clip_contents = true
	frame.add_child(_map_panel)

	var bg := ColorRect.new()
	bg.color = COLOR_SEA
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_panel.add_child(bg)

	# Terrain, sailing routes, region pins and "you are here", under the hotspot
	# buttons added below.
	_map_art = Control.new()
	_map_art.set_anchors_preset(Control.PRESET_FULL_RECT)
	_map_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_art.draw.connect(_draw_art)
	_map_panel.add_child(_map_art)
	# Connected last: the panel emits resized while it is still being built, and
	# the layout pass needs the art node to already exist.
	_map_panel.resized.connect(_layout_hotspots)

	var shadow := Control.new()
	shadow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shadow.draw.connect(_draw_inset_shadow.bind(shadow))
	frame.add_child(shadow)

	var overlay := TextureRect.new()
	overlay.texture = MAP_FRAME_TOP
	overlay.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.size = FRAME_SIZE
	frame.add_child(overlay)

	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.position = Vector2(1316, 96)
	close_btn.size = Vector2(40, 40)
	close_btn.focus_mode = Control.FOCUS_NONE
	close_btn.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close_btn.pressed.connect(close)
	frame.add_child(close_btn)

	var names := {}
	for key in REGION_POINTS:
		for region_name in REGION_POINTS[key]:
			names[region_name] = true
	for region_name in names:
		_add_hotspot(region_name)

	_build_detail_panel()

# Draws the terrain baked by scripts/tools/bake_world_map.gd, letterboxed to keep
# the world's aspect ratio, plus the player's position on it. Silently draws
# nothing until that bake has been run, leaving the plain dark panel behind it.
func _draw_art() -> void:
	var key := _map_key()
	var tex := MapData.texture(key)
	if tex == null:
		return
	var art := _fit(Vector2(tex.get_size()), _map_art.size)
	_map_art.draw_texture_rect(tex, art, false)

	var points: Dictionary = _region_points(key)
	for route in ROUTES:
		if points.has(route[0]) and points.has(route[1]):
			_draw_route(_to_panel(key, points[route[0]], art), _to_panel(key, points[route[1]], art))
	for region_name in points:
		var pin: Vector2 = _to_panel(key, points[region_name], art)
		_map_art.draw_rect(Rect2(pin - Vector2(5, 5), Vector2(10, 10)), COLOR_INK)
		_map_art.draw_rect(Rect2(pin - Vector2(3, 3), Vector2(6, 6)), COLOR_ACCENT)
	_draw_compass(art)

	var world := get_tree().current_scene
	if world == null or MapData.scene_key(world) != key:
		return
	var me = world.get("_local_player")
	if me == null or not is_instance_valid(me):
		return
	var at := _to_panel(key, me.global_position, art)
	# Ink halo first so the dot survives whatever terrain it lands on.
	_map_art.draw_rect(Rect2(at - Vector2(7, 7), Vector2(14, 14)), COLOR_INK)
	_map_art.draw_rect(Rect2(at - Vector2(5, 5), Vector2(10, 10)), COLOR_SELF)
	_map_art.draw_string(
		MONOCRAFT, at + Vector2(-20, -12), "YOU", HORIZONTAL_ALIGNMENT_CENTER, 40, 13,
		COLOR_SELF
	)

func _draw_inset_shadow(canvas: Control) -> void:
	var r := MAP_RECT
	for i in 2:
		var edge := COLOR_BEZEL_SHADOW
		edge.a = 0.32 - 0.16 * i
		var o := BEZEL_STEP * i
		canvas.draw_rect(Rect2(r.position + Vector2(o, o), Vector2(r.size.x - o, BEZEL_STEP)), edge)
		canvas.draw_rect(Rect2(r.position + Vector2(o, o + BEZEL_STEP), Vector2(BEZEL_STEP, r.size.y - o - BEZEL_STEP)), edge)

# Dashed line between two islands: the boats make these trips, so the map says so.
func _draw_route(from: Vector2, to: Vector2) -> void:
	var span := to - from
	var length := span.length()
	if length <= 0.0:
		return
	var step := span / length
	var travelled := 0.0
	while travelled < length:
		var seg := minf(7.0, length - travelled)
		_map_art.draw_line(
			from + step * travelled, from + step * (travelled + seg), COLOR_ROUTE, 2.0
		)
		travelled += 14.0

func _draw_compass(art: Rect2) -> void:
	var c := art.position + Vector2(art.size.x - 26.0, 26.0)
	_map_art.draw_polygon(
		PackedVector2Array([
			c + Vector2(0, -13), c + Vector2(7, 7), c + Vector2(0, 2), c + Vector2(-7, 7)
		]),
		PackedColorArray([COLOR_ACCENT])
	)
	_map_art.draw_string(
		MONOCRAFT, c + Vector2(-14, 26), "N", HORIZONTAL_ALIGNMENT_CENTER, 28, 13, COLOR_ACCENT
	)

func _region_points(key: String) -> Dictionary:
	return REGION_POINTS.get(key, {})

# World position -> pixels inside the letterboxed art rect.
func _to_panel(key: String, world_pos: Vector2, art: Rect2) -> Vector2:
	var tex := MapData.texture(key)
	if tex == null:
		return art.position + art.size * 0.5
	var frac := MapData.world_to_image(key, world_pos) / Vector2(tex.get_size())
	return art.position + frac * art.size

# Labels are placed off the same world points as the pins, so a re-bake or a
# resized panel moves them together instead of drifting onto the wrong island.
func _layout_hotspots() -> void:
	var key := _map_key()
	var tex := MapData.texture(key)
	var points: Dictionary = _region_points(key)
	var art := _fit(Vector2(tex.get_size()) if tex != null else Vector2.ZERO, _map_panel.size)
	for region_name in _hotspots:
		var hotspot: Button = _hotspots[region_name]
		var marker: ColorRect = _markers[region_name]
		if tex == null or not points.has(region_name):
			hotspot.visible = false
			marker.visible = false
			continue
		hotspot.visible = true
		var at := _to_panel(key, points[region_name], art)
		hotspot.position = at - Vector2(hotspot.size.x * 0.5, hotspot.size.y + 10.0)
		marker.position = hotspot.position + Vector2(hotspot.size.x - 4.0, -4.0)
	_map_art.queue_redraw()

# Largest centred rect of the given aspect that fits inside the panel.
func _fit(tex_size: Vector2, panel: Vector2) -> Rect2:
	if tex_size.x <= 0.0 or tex_size.y <= 0.0:
		return Rect2(Vector2.ZERO, panel)
	var scale := minf(panel.x / tex_size.x, panel.y / tex_size.y)
	var size := tex_size * scale
	return Rect2((panel - size) * 0.5, size)

func _add_hotspot(region_name: String) -> void:
	var hotspot := Button.new()
	hotspot.text = region_name
	hotspot.flat = true
	hotspot.size = Vector2(150, 24)
	hotspot.add_theme_font_override("font", MONOCRAFT)
	hotspot.add_theme_font_size_override("font_size", 15)
	hotspot.add_theme_color_override("font_color", Color.WHITE)
	hotspot.add_theme_color_override("font_hover_color", COLOR_ACCENT)
	hotspot.add_theme_color_override("font_pressed_color", COLOR_ACCENT)
	# The label sits over water or terrain depending on the region, so it carries
	# its own outline rather than relying on either being dark enough.
	hotspot.add_theme_color_override("font_outline_color", COLOR_INK)
	hotspot.add_theme_constant_override("outline_size", 6)
	hotspot.visible = false
	hotspot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_panel.add_child(hotspot)
	_hotspots[region_name] = hotspot

	var marker := ColorRect.new()
	marker.color = COLOR_MARKER
	marker.size = Vector2(10, 10)
	marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	marker.visible = false
	_map_panel.add_child(marker)
	_markers[region_name] = marker

func _build_detail_panel() -> void:
	_detail_panel = PanelContainer.new()
	_detail_panel.custom_minimum_size = Vector2(360, 200)
	_detail_panel.set_anchors_preset(Control.PRESET_CENTER)
	_detail_panel.anchor_left = 0.5
	_detail_panel.anchor_right = 0.5
	_detail_panel.anchor_top = 0.5
	_detail_panel.anchor_bottom = 0.5
	_detail_panel.offset_left = -180.0
	_detail_panel.offset_right = 180.0
	_detail_panel.offset_top = -100.0
	_detail_panel.offset_bottom = 100.0
	_detail_panel.visible = false
	_root.add_child(_detail_panel)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	_detail_panel.add_child(body)

	_detail_title = Label.new()
	_detail_title.add_theme_color_override("font_color", COLOR_ACCENT)
	_detail_title.add_theme_font_size_override("font_size", 18)
	body.add_child(_detail_title)

	_detail_body = RichTextLabel.new()
	_detail_body.bbcode_enabled = true
	_detail_body.fit_content = true
	_detail_body.custom_minimum_size = Vector2(340, 130)
	body.add_child(_detail_body)

	var close_btn := Button.new()
	close_btn.text = "Close"
	close_btn.pressed.connect(func(): _detail_panel.visible = false)
	body.add_child(close_btn)

func _show_detail(region_name: String) -> void:
	_detail_title.text = region_name
	var quests: Array = _quests_by_region.get(region_name, [])
	if quests.is_empty():
		_detail_body.text = "No available Trials here right now."
	else:
		var lines := []
		for q in quests:
			lines.append("[b]%s[/b] (%s)\n%s" % [q.get("name", ""), q.get("npc", ""), q.get("description", "")])
		_detail_body.text = "\n\n".join(lines)
	_detail_panel.visible = true

# Pull /api/sidequests and mark any region with an unlocked-but-incomplete
# Trial with a yellow dot. Same fetch/response shape as npc.gd's
# _fetch_sidequests - kept local since HUD autoloads don't share NPC state.
func _refresh_markers() -> void:
	_quests_by_region.clear()
	for m in _markers.values():
		m.visible = false
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/sidequests?token=" + NetworkManager.session_token.uri_encode()
	if req.request(url) != OK:
		req.queue_free()
		return
	var r: Array = await req.request_completed
	req.queue_free()
	if int(r[1]) != 200 or (r[3] as PackedByteArray).size() == 0:
		return
	var json = JSON.parse_string((r[3] as PackedByteArray).get_string_from_utf8())
	if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		return
	var quests = json.get("quests", [])
	if typeof(quests) != TYPE_ARRAY:
		return
	for q in quests:
		var available := bool(q.get("unlocked", false)) and not bool(q.get("completed", false))
		if not available:
			continue
		var region := String(q.get("region", ""))
		if not _quests_by_region.has(region):
			_quests_by_region[region] = []
		_quests_by_region[region].append(q)
		# Only for regions this map actually shows, or the dot lands in a corner
		# of a map its region isn't on.
		if _markers.has(region) and _hotspots[region].visible:
			_markers[region].visible = true
