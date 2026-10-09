class_name WorldMapBaker
extends RefCounted

## Renders a top-down PNG of each gameplay world so the minimap and the world map
## can draw real terrain instead of a flat placeholder rect.
##
## Two entry points, both thin wrappers over bake_all():
##   bake_world_map.gd      EditorScript - open it and hit File > Run (Ctrl+Shift+X)
##   bake_world_map_cli.gd  godot --script scripts/tools/bake_world_map_cli.gd
## The CLI form needs a real display; --headless has no renderer and bakes black.
##
## Output:
##   res://assets/map/<key>.png     the image
##   res://assets/map/bounds.json   the world-space rect each image covers
## map_data.gd reads both at runtime. Re-run whenever the tilemaps move; if the
## files are missing both HUDs fall back to the old flat-rect look.

const SCENES := {
	"open_world": "res://scenes/open_world.tscn",
	"village": "res://scenes/village.tscn",
	"factory_island": "res://scenes/factory_island.tscn",
}

const OUT_DIR := "res://assets/map"

# Layers that are backdrop fill rather than world content. Both scenes sit on the
# same 4032x3312 ocean plane while their actual content spans well under half
# that, so letting these set the extent bakes a tiny island adrift in blue. They
# still render - they just get no vote on the framing.
const EXTENT_EXCLUDED := ["Water"]

# Breathing room around the content, in world pixels, so nothing sits flush
# against the edge of the image.
const PADDING := 64.0

# World pixels per baked pixel. 1:1 keeps the tile art exact and the worlds are
# small enough for it (open_world is 1760x960), so there is no reason to throw
# detail away. If a future region pushes the printed size toward MAX_DIM, raise
# this - but only to a power of two, since nearest-neighbour downscaling on an
# arbitrary ratio turns pixel art to mush.
const DOWNSCALE := 1

# Godot refuses to allocate a viewport past this on either axis.
const MAX_DIM := 16384

## Bakes every scene in SCENES. `host` is any node already in the tree that the
## offscreen SubViewport can hang off - the editor's base control, or the scene
## tree root from the CLI. Returns how many worlds were written.
static func bake_all(host: Node) -> int:
	if not DirAccess.dir_exists_absolute(OUT_DIR):
		DirAccess.make_dir_recursive_absolute(OUT_DIR)

	var manifest := {"downscale": DOWNSCALE, "worlds": {}}
	for key in SCENES:
		var entry: Dictionary = await _bake(host, String(key), String(SCENES[key]))
		if not entry.is_empty():
			manifest["worlds"][key] = entry

	if manifest["worlds"].is_empty():
		push_error("[WorldMapBaker] nothing baked, leaving bounds.json alone")
		return 0

	var f := FileAccess.open(OUT_DIR + "/bounds.json", FileAccess.WRITE)
	if f == null:
		push_error("[WorldMapBaker] could not write bounds.json")
		return 0
	f.store_string(JSON.stringify(manifest, "\t"))
	f.close()
	return manifest["worlds"].size()

static func _bake(host: Node, key: String, scene_path: String) -> Dictionary:
	var packed: PackedScene = load(scene_path)
	if packed == null:
		push_error("[WorldMapBaker] cannot load %s" % scene_path)
		return {}

	# instantiate() does not fire _ready() - that only happens on entering the
	# tree - so this is the window in which to strip everything that would.
	var world: Node = packed.instantiate()
	_strip(world)

	var bounds := _world_bounds(world)
	if bounds.size.x <= 0.0 or bounds.size.y <= 0.0:
		push_error("[WorldMapBaker] %s has no used tiles" % key)
		world.free()
		return {}

	var dim := Vector2i(ceili(bounds.size.x / DOWNSCALE), ceili(bounds.size.y / DOWNSCALE))
	if dim.x > MAX_DIM or dim.y > MAX_DIM:
		push_error("[WorldMapBaker] %s would be %dx%d, past the %d limit - raise DOWNSCALE"
			% [key, dim.x, dim.y, MAX_DIM])
		world.free()
		return {}

	var vp := SubViewport.new()
	vp.size = dim
	vp.disable_3d = true
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	# A SubViewport gets its own World2D, so the DayNight CanvasModulate autoload
	# (which lives in the root viewport) cannot tint the bake. That is deliberate
	# - a map baked at 3am would come out permanently dark.
	vp.add_child(world)
	# The viewport has to be in the tree before the camera goes in it -
	# make_current() is a no-op on a camera that is not yet inside a tree, which
	# silently bakes the world's top-left corner at 1:1 instead of the whole map.
	host.add_child(vp)
	# From the CLI entry point the tree is still coming up during _initialize(),
	# so the subtree is not live yet and make_current() silently no-ops - which
	# bakes the world's top-left corner at 1:1 instead of the whole map.
	await host.get_tree().process_frame

	var cam := Camera2D.new()
	cam.enabled = true
	cam.zoom = Vector2.ONE / float(DOWNSCALE)
	cam.position = bounds.get_center()
	vp.add_child(cam)
	cam.make_current()
	if not cam.is_current():
		push_error("[WorldMapBaker] camera did not go current, %s would bake wrong" % key)
		host.remove_child(vp)
		vp.queue_free()
		return {}

	# Two frames: the first can land before the tilemaps have finished building
	# their meshes, which bakes an empty image.
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw

	var img := vp.get_texture().get_image()
	var png_path := "%s/%s.png" % [OUT_DIR, key]
	var err := img.save_png(png_path)

	host.remove_child(vp)
	vp.queue_free()

	if err != OK:
		push_error("[WorldMapBaker] saving %s failed (%d)" % [png_path, err])
		return {}

	print("[WorldMapBaker] %s -> %dx%d px, covers %s" % [key, dim.x, dim.y, bounds])
	return {
		"x": bounds.position.x,
		"y": bounds.position.y,
		"w": bounds.size.x,
		"h": bounds.size.y,
		"iw": dim.x,
		"ih": dim.y,
	}

# Keep the TileMapLayers and nothing else. NPCs, spawn markers, door triggers and
# collision bodies are either invisible or things a map should not show, and
# several carry scripts that reach for autoloads (NetworkManager, global) in
# their _ready(). Scripts come off the survivors too, so the water shader does
# not bake a frozen ripple frame into the terrain.
static func _strip(node: Node) -> void:
	node.set_script(null)
	for child in node.get_children():
		if _has_tilemap(child):
			_strip(child)
		else:
			node.remove_child(child)
			child.free()

static func _has_tilemap(node: Node) -> bool:
	if node is TileMapLayer:
		return true
	for child in node.get_children():
		if _has_tilemap(child):
			return true
	return false

# Union of every layer's used tiles, in the root's coordinate space. Transforms
# are walked by hand rather than via get_global_transform() because the scene is
# deliberately still outside the tree at this point.
static func _world_bounds(root: Node) -> Rect2:
	var bounds := Rect2()
	var seeded := false
	for layer in _tilemaps(root):
		var used: Rect2i = layer.get_used_rect()
		if used.size.x == 0 or used.size.y == 0 or layer.tile_set == null:
			continue
		if EXTENT_EXCLUDED.has(String(layer.name)):
			continue
		var tile: Vector2i = layer.tile_set.tile_size
		var local := Rect2(
			Vector2(used.position.x * tile.x, used.position.y * tile.y),
			Vector2(used.size.x * tile.x, used.size.y * tile.y)
		)
		var rect := (_transform_to(layer, root) * local).abs()
		if seeded:
			bounds = bounds.merge(rect)
		else:
			bounds = rect
			seeded = true
	return bounds.grow(PADDING) if seeded else bounds

static func _transform_to(node: Node2D, root: Node) -> Transform2D:
	var xform := Transform2D.IDENTITY
	var cur: Node = node
	while cur != null and cur != root:
		if cur is Node2D:
			xform = (cur as Node2D).transform * xform
		cur = cur.get_parent()
	return xform

static func _tilemaps(node: Node) -> Array[TileMapLayer]:
	var out: Array[TileMapLayer] = []
	if node is TileMapLayer:
		out.append(node)
	for child in node.get_children():
		out.append_array(_tilemaps(child))
	return out
