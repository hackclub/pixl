extends SceneTree

## Finishes scenes/factory_island.tscn (the "Factory Island" region): bakes
## collision into it and re-anchors the prop sprites for depth sorting.
##
##   cd apps/game && godot --headless --path . --script scripts/tools/build_factory_island.gd
##
## Safe to re-run: the old "Collision" node is removed first, and props are only
## re-anchored once (tracked by the Props node's `base_anchored` metadata).
##
## The scene came from the art bundle as a baked tile map with no collision at
## all, so without this a player could walk straight into the sea or through the
## factory. Two kinds of blocker are added:
##   * water: every cell inside the bake's water window that is not land (Ground
##     or Path), merged into as few rectangles as possible
##   * props: a footprint rectangle at the base of each building / object
##
## Sprite2D props were positioned by their centre, but Y-sorting against the
## player uses the node's origin, so a tall building would sort by its middle and
## the player would walk "behind" it from the wrong side. Re-anchoring moves each
## node's origin to the bottom of its sprite and offsets the sprite back, so it
## renders in exactly the same place.

const SCENE_PATH := "res://scenes/factory_island.tscn"
const TILE := 16
# The bundle painted water 6 tiles past the 42x26 map on every side; blocking the
# same window keeps the player inside it.
const WIN_MIN := Vector2i(-6, -6)
const WIN_MAX := Vector2i(48, 32) # exclusive

# Footprint (width, height) in island pixels, centred on the sprite's base, by
# texture file name. Missing entries get no collision (tiny decor).
const FOOTPRINTS := {
	"hangar.png": Vector2(58, 34),
	"factory.png": Vector2(116, 40),
	"tanks_b.png": Vector2(22, 18),
	"conveyor_rollers.png": Vector2(152, 24),
	"tree.png": Vector2(14, 10),
	"barrels.png": Vector2(22, 14),
	"pipes.png": Vector2(48, 20),
	"lamp_b.png": Vector2(8, 8),
	"fence_rail_long.png": Vector2(64, 10),
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

	_bridge_causeway(root)

	var body := StaticBody2D.new()
	body.name = "Collision"
	root.add_child(body)
	body.owner = root

	var count := 0
	for r in _merged_water_rects(_land_cells(root)):
		count += _add_rect(body, root, r, "Water")
	for s in props.get_children():
		var sp := s as Sprite2D
		var fp: Vector2 = FOOTPRINTS.get(sp.texture.resource_path.get_file(), Vector2.ZERO)
		if fp == Vector2.ZERO:
			continue
		# the sprite's origin is its base after _reanchor
		var base: Vector2 = props.position + sp.position
		count += _add_rect(body, root, Rect2(base.x - fp.x / 2.0, base.y - fp.y, fp.x, fp.y), "Prop")

	var out := PackedScene.new()
	var err := out.pack(root)
	if err != OK:
		push_error("pack failed: %d" % err)
		quit(1)
		return
	err = ResourceSaver.save(out, SCENE_PATH)
	print("[build_factory_island] saved %s (%d collision shapes, err=%d)" % [SCENE_PATH, count, err])
	quit(0 if err == OK else 1)


## The bundle's west causeway (cells x 0-2, rows 10-11, where the return boat
## docks) is separated from the island proper by one water cell at x=3, so a
## player could never walk to it. Fill that gap with ground and the same rim
## tiles the causeway already uses, and drop the rim at x=4 that capped the
## island's old west edge. Idempotent.
func _bridge_causeway(root: Node) -> void:
	var ground: TileMapLayer = root.get_node("Ground")
	var rims: TileMapLayer = root.get_node("Rims")
	for y in [10, 11]:
		var from := Vector2i(2, y)
		var to := Vector2i(3, y)
		ground.set_cell(to, ground.get_cell_source_id(from), ground.get_cell_atlas_coords(from))
		rims.set_cell(to, rims.get_cell_source_id(from), rims.get_cell_atlas_coords(from))
		rims.erase_cell(Vector2i(4, y))


func _reanchor(props: Node2D) -> void:
	for s in props.get_children():
		var sp := s as Sprite2D
		var size := sp.texture.get_size() * sp.scale
		var bottom := sp.position.y + sp.offset.y * sp.scale.y + size.y / 2.0
		var shift := bottom - sp.position.y
		sp.position.y = bottom
		sp.offset.y -= shift / sp.scale.y


func _land_cells(root: Node) -> Dictionary:
	var land := {}
	for layer_name in ["Ground", "Path"]:
		var layer: TileMapLayer = root.get_node(layer_name)
		for c in layer.get_used_cells():
			land[c] = true
	return land


## Water cells (window minus land) as pixel rects: runs along each row, then runs
## with the same x-span on consecutive rows are fused into one taller rect.
func _merged_water_rects(land: Dictionary) -> Array[Rect2]:
	var merged: Array = [] # [x0, x1_exclusive, y0, y1_exclusive]
	var last_for_span := {} # "x0:x1" -> index into merged of the most recent run with that span
	for y in range(WIN_MIN.y, WIN_MAX.y):
		var x := WIN_MIN.x
		while x < WIN_MAX.x:
			if land.has(Vector2i(x, y)):
				x += 1
				continue
			var x0 := x
			while x < WIN_MAX.x and not land.has(Vector2i(x, y)):
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
