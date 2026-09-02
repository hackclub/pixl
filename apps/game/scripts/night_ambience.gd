extends Node2D

# Fireflies. A single particle emitter that rides along with the camera and only
# lights up after dark, driven entirely by DayNight.night_amount(), so it comes
# and goes with the sky and never shows up indoors, in menus, or during the day.

var _p: CPUParticles2D

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	z_index = 15
	_p = CPUParticles2D.new()
	_p.texture = DayNight.glow_texture()
	_p.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	_p.amount = 28
	_p.lifetime = 5.0
	_p.lifetime_randomness = 0.6
	_p.preprocess = 3.0
	_p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	_p.emission_rect_extents = Vector2(520, 320)
	_p.direction = Vector2(0, -1)
	_p.spread = 180.0
	_p.gravity = Vector2.ZERO
	_p.initial_velocity_min = 3.0
	_p.initial_velocity_max = 12.0
	_p.damping_min = 2.0
	_p.damping_max = 6.0
	_p.scale_amount_min = 0.12
	_p.scale_amount_max = 0.24
	_p.color = Color(0.85, 1.0, 0.55)
	# Blink: fade each mote in and back out across its life.
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.25, 0.75, 1.0])
	ramp.colors = PackedColorArray([
		Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 1), Color(1, 1, 1, 0),
	])
	_p.color_ramp = ramp
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_p.material = mat
	_p.emitting = false
	add_child(_p)

func _process(_delta: float) -> void:
	var amt := DayNight.night_amount()
	_p.emitting = amt > 0.12
	_p.modulate.a = clampf((amt - 0.12) / 0.5, 0.0, 1.0)
	var cam := get_viewport().get_camera_2d()
	if cam:
		global_position = cam.get_screen_center_position()
