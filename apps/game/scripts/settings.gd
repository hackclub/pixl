extends Node

signal font_scale_changed
signal zoom_changed

const PATH := "user://settings.json"

var music_enabled := true
var music_volume := 0.2
var font_scale := 1.0
var zoom_level := 1.0
var day_night_enabled := true
var theme_name := "dark"

func _ready() -> void:
	# HUD text is sized for a 1600x900 desktop canvas, bump the default on
	# touch devices so it's actually readable before a saved preference (if
	# any) overrides it below.
	if DisplayServer.is_touchscreen_available():
		font_scale = 1.3
	_load()
	PixlTheme.boot()

func _load() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		return
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(data) != TYPE_DICTIONARY:
		return
	music_enabled = bool(data.get("music_enabled", music_enabled))
	music_volume = float(data.get("music_volume", music_volume))
	font_scale = clampf(float(data.get("font_scale", font_scale)), 1.0, 1.6)
	zoom_level = clampf(float(data.get("zoom_level", zoom_level)), 0.6, 1.4)
	day_night_enabled = bool(data.get("day_night_enabled", day_night_enabled))
	theme_name = String(data.get("theme_name", theme_name))

func save() -> void:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify({
		"music_enabled": music_enabled,
		"music_volume": music_volume,
		"font_scale": font_scale,
		"zoom_level": zoom_level,
		"day_night_enabled": day_night_enabled,
		"theme_name": theme_name,
	}))
	f.close()

func set_music_enabled(on: bool) -> void:
	music_enabled = on
	save()
	Music.apply_settings()

func set_music_volume(v: float) -> void:
	music_volume = clampf(v, 0.0, 1.0)
	save()
	Music.apply_settings()

func set_font_scale(v: float) -> void:
	font_scale = clampf(v, 1.0, 1.6)
	save()
	font_scale_changed.emit()

func fs(base: int) -> int:
	return int(round(base * font_scale))

# Canvas is base 1600x900 with stretch mode canvas_items/expand, which
# shrinks the whole UI by min(real_width/1600, real_height/900) to fit the
# actual screen. That's barely noticeable for small HUD elements but main
# menu/pause menu are big and central, so the shrink alone makes them "small
# af" on a phone, work out how much got shrunk and hand back a multiplier
# that undoes it, then stack the user's own font_scale on top like everywhere
# else.
func menu_scale_factor() -> float:
	if not DisplayServer.is_touchscreen_available():
		return 1.0
	var vp := get_viewport().get_visible_rect().size
	if vp.x <= 0.0 or vp.y <= 0.0:
		return font_scale
	var shrink := minf(vp.x / 1600.0, vp.y / 900.0)
	var undo := 1.0 / clampf(shrink, 0.25, 1.0)
	return clampf(undo * font_scale, 1.0, 2.2)

# Duplicates a theme and scales every font size / constant / stylebox margin
# by menu_scale_factor(), instead of Control.scale, a transform just
# stretches the already-rasterized glyph bitmaps, which blurs a pixel font
# like this one and reads as a completely different (wrong) font. This
# re-rasterizes text at the real target size instead, so it stays crisp.
func touch_menu_theme(base: Theme) -> Theme:
	var t: Theme = base.duplicate(true)
	var factor := menu_scale_factor()
	if factor == 1.0:
		return t
	if t.has_default_font_size():
		t.default_font_size = int(round(t.default_font_size * factor))
	for theme_type in t.get_type_list():
		for name in t.get_font_size_list(theme_type):
			t.set_font_size(name, theme_type, int(round(t.get_font_size(name, theme_type) * factor)))
		for name in t.get_constant_list(theme_type):
			t.set_constant(name, theme_type, int(round(t.get_constant(name, theme_type) * factor)))
		for name in t.get_stylebox_list(theme_type):
			var sb := t.get_stylebox(name, theme_type)
			if sb is StyleBoxFlat or sb is StyleBoxEmpty:
				sb.content_margin_left *= factor
				sb.content_margin_top *= factor
				sb.content_margin_right *= factor
				sb.content_margin_bottom *= factor
	return t

func set_day_night_enabled(on: bool) -> void:
	day_night_enabled = on
	save()

func set_theme_name(name: String) -> void:
	theme_name = name
	save()

func set_zoom_level(v: float) -> void:
	zoom_level = clampf(v, 0.6, 1.4)
	save()
	zoom_changed.emit()

func reset_zoom() -> void:
	set_zoom_level(1.0)
