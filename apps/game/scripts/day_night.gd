extends CanvasModulate

# World day/night tint. This is a CanvasModulate autoload, so it colours every
# CanvasItem on the default canvas (layer 0), i.e. the game world, while the
# HUDs, which each live on their own CanvasLayer, stay at full brightness.
#
# The time of day is derived from real wall-clock time (Time.get_unix_time...),
# so every client independently lands on the exact same phase without any
# networking, two players standing together always see the same sky.

# Only the outdoor scenes get a sky; interiors and menus stay neutral white.
const OUTDOOR := ["village", "open_world"]

var _grad: Gradient
var _glow_tex: GradientTexture2D
var _was_outdoor := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	color = Color.WHITE
	_grad = Gradient.new()
	# Kept deliberately gentle, even midnight stays plenty bright to play in.
	_grad.offsets = PackedFloat32Array([0.0, 0.22, 0.28, 0.35, 0.65, 0.72, 0.80, 1.0])
	_grad.colors = PackedColorArray([
		Color(0.36, 0.42, 0.68),  # deep night (blue)
		Color(0.36, 0.42, 0.68),
		Color(0.92, 0.72, 0.60),  # dawn (warm)
		Color(1.0, 1.0, 1.0),     # full day
		Color(1.0, 1.0, 1.0),
		Color(0.99, 0.70, 0.47),  # dusk (orange)
		Color(0.36, 0.42, 0.68),  # into night
		Color(0.36, 0.42, 0.68),
	])

func _process(delta: float) -> void:
	var outdoor := _is_outdoor()
	var target := Color.WHITE
	if Settings.day_night_enabled and outdoor:
		target = _grad.sample(_phase())
	# Snap when crossing in or out of the world. This modulate covers every canvas
	# including the menus, so easing here meant a menu opened at night inherited
	# the world's tint and visibly faded it off. Easing still applies in-world, for
	# the gradual time-of-day drift and the settings toggle.
	if outdoor != _was_outdoor:
		color = target
	else:
		color = color.lerp(target, clampf(delta * 2.0, 0.0, 1.0))
	_was_outdoor = outdoor

func _is_outdoor() -> bool:
	var cur := get_tree().current_scene
	return cur != null and OUTDOOR.has(cur.scene_file_path.get_file().get_basename())

# Where we are in the 24h cycle, driven by the player's own local wall clock
# (not server time or unix epoch) so in-game night actually lines up with
# night outside their window: 0.0 = local midnight, 0.5 = local noon.
func _phase() -> float:
	var t := Time.get_time_dict_from_system()
	var seconds_into_day: int = int(t.hour) * 3600 + int(t.minute) * 60 + int(t.second)
	return seconds_into_day / 86400.0

# 0.0 in broad daylight -> 1.0 at deep night, following the same phase as the
# sky. Returns 0.0 whenever the cycle is off or we're indoors/in a menu, so
# night-only ambience (fireflies, lit windows) can just multiply by this.
func night_amount() -> float:
	if not Settings.day_night_enabled or not _is_outdoor():
		return 0.0
	var lum := _grad.sample(_phase()).get_luminance()
	return clampf((1.0 - lum) / 0.5, 0.0, 1.0)

# A shared soft round glow, built once and reused by lanterns and fireflies.
func glow_texture() -> Texture2D:
	if _glow_tex == null:
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 1.0])
		g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
		_glow_tex = GradientTexture2D.new()
		_glow_tex.gradient = g
		_glow_tex.width = 64
		_glow_tex.height = 64
		_glow_tex.fill = GradientTexture2D.FILL_RADIAL
		_glow_tex.fill_from = Vector2(0.5, 0.5)
		_glow_tex.fill_to = Vector2(1.0, 0.5)
	return _glow_tex
