extends SceneTree

## Finishes scenes/pixel_cafe.tscn (the "Pixel Cafe" region): bakes collision
## into it and base-anchors the prop sprites for depth sorting.
##
##   cd apps/game && godot --headless --path . --script scripts/tools/build_pixel_cafe.gd
##
## Safe to re-run: the old "Collision" node is removed first, and props are only
## re-anchored once (tracked by the Props node's `base_anchored` metadata).
##
## Same approach as build_factory_island.gd. Two kinds of blocker:
##   * water: every cell inside the water window that is not walkable (Ground,
##     Path or Docks), merged into as few rectangles as possible. The cliff faces
##     hang off the island's south edge onto non-land cells, so they block too.
##   * props: a footprint rectangle at the base of each building / object

const SCENE_PATH := "res://scenes/pixel_cafe.tscn"
const TILE := 16
# The island and its two docks span cells 0-41 x 2-24; six cells of margin on
# every side keeps the player inside the region.
const WIN_MIN := Vector2i(-6, -6)
const WIN_MAX := Vector2i(48, 32) # exclusive
const WALKABLE := ["Ground", "Path", "Docks"]
const BLOCKING := ["Fences"]

# Footprint (width, height) in island pixels, centred on the sprite's base, by
# texture file name. Missing entries get no collision (pots, mailbox, decor).
const FOOTPRINTS := {
	"Houses.png": Vector2(80, 24),
	"tavern.png": Vector2(104, 28),
	"large_market_canopy.png": Vector2(104, 18),
	"market_display.png": Vector2(30, 10),
	"bread_cart.png": Vector2(28, 12),
	"trellis_garden.png": Vector2(50, 12),
	"rocks_cluster.png": Vector2(48, 14),
	"menu_stand.png": Vector2(16, 8),
	"cafe_table.png": Vector2(28, 12),
	"fire_pit.png": Vector2(24, 8),
	"lamp_post.png": Vector2(6, 6),
	"Trees_cherryblossom.png": Vector2(8, 6),
	"Trees_oak_young.png": Vector2(6, 5),
}


func _initialize() -> void:
	var packed: PackedScene = load(SCENE_PATH)
	var root: Node = packed.instantiate()

	var old := root.get_node_or_null("Collision")
	if old:
		root.remove_child(old)
		old.free()

	var props: Node2D = root.get_node("Props")
	if not props.has_meta("base_anchored"):
		_reanchor(props)
		props.set_meta("base_anchored", true)

	var body := StaticBody2D.new()
	body.name = "Collision"
	root.add_child(body)
	body.owner = root

	var count := 0
	for r in _merged_water_rects(_walkable_cells(root)):
		count += _add_rect(body, root, r, "Water")
	for s in props.get_children():
		var sp := s as Sprite2D
		var fp: Vector2 = FOOTPRINTS.get(sp.texture.resource_path.get_file(), Vector2.ZERO)
		if fp == Vector2.ZERO:
			continue
		var base: Vector2 = props.position + sp.position
		count += _add_rect(body, root, Rect2(base.x - fp.x / 2.0, base.y - fp.y, fp.x, fp.y), "Prop")

	var out := PackedScene.new()
	var err := out.pack(root)
	if err != OK:
		push_error("pack failed: %d" % err)
		quit(1)
		return
	err = ResourceSaver.save(out, SCENE_PATH)
	print("[build_pixel_cafe] saved %s (%d collision shapes, err=%d)" % [SCENE_PATH, count, err])
	quit(0 if err == OK else 1)


func _reanchor(props: Node2D) -> void:
	for s in props.get_children():
		var sp := s as Sprite2D
		var size := sp.texture.get_size() * sp.scale
		var bottom := sp.position.y + sp.offset.y * sp.scale.y + size.y / 2.0
		var shift := bottom - sp.position.y
		sp.position.y = bottom
		sp.offset.y -= shift / sp.scale.y


func _walkable_cells(root: Node) -> Dictionary:
	var cells := {}
	for layer_name in WALKABLE:
		var layer: TileMapLayer = root.get_node(layer_name)
		for c in layer.get_used_cells():
			cells[c] = true
	for layer_name in BLOCKING:
		var layer := root.get_node_or_null(layer_name) as TileMapLayer
		if layer:
			for c in layer.get_used_cells():
				cells.erase(c)
	return cells


## Water cells (window minus walkable) as pixel rects: runs along each row, then
## runs with the same x-span on consecutive rows are fused into one taller rect.
func _merged_water_rects(walkable: Dictionary) -> Array[Rect2]:
	var merged: Array = [] # [x0, x1_exclusive, y0, y1_exclusive]
	var last_for_span := {}
	for y in range(WIN_MIN.y, WIN_MAX.y):
		var x := WIN_MIN.x
		while x < WIN_MAX.x:
			if walkable.has(Vector2i(x, y)):
				x += 1
				continue
			var x0 := x
			while x < WIN_MAX.x and not walkable.has(Vector2i(x, y)):
				x += 1
			var key := "%d:%d" % [x0, x]
			if last_for_span.has(key) and merged[last_for_span[key]][3] == y:
				merged[last_for_span[key]][3] = y + 1
			else:
				merged.append([x0, x, y, y + 1])
				last_for_span[key] = merged.size() - 1
	var out: Array[Rect2] = []
	for m in merged:
		out.append(Rect2(m[0] * TILE, m[2] * TILE, (m[1] - m[0]) * TILE, (m[3] - m[2]) * TILE))
	return out


func _add_rect(body: StaticBody2D, root: Node, r: Rect2, label: String) -> int:
	var shape := RectangleShape2D.new()
	shape.size = r.size
	var cs := CollisionShape2D.new()
	cs.name = "%s%d" % [label, body.get_child_count()]
	cs.shape = shape
	cs.position = r.position + r.size / 2.0
	body.add_child(cs)
	cs.owner = root
	return 1
