extends TileMapLayer

# Water animation runs entirely on the GPU via a canvas_item shader.
#
# The previous version animated water by calling set_cell() on every water
# tile (~52,000 of them) five times per second. That forces Godot to rebuild
# the whole tilemap mesh each tick, fine on native, but it tanks the HTML5/
# WASM build. The shader does the same rippling look for ~zero CPU cost.

@export var wave_speed: float = 1.0
@export var wave_strength: float = 0.012

func _ready() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/water.gdshader")
	mat.set_shader_parameter("speed", wave_speed)
	mat.set_shader_parameter("wave_strength", wave_strength)
	material = mat
