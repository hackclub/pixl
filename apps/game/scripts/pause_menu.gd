extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const ONBOARDING := preload("res://scripts/onboarding.gd")

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)
# Main menu & pause menu keep the original Monocraft face; the rest of the game
# moved its default menu font to Pixelify Sans (see commit b8b1360).
const OLD_MENU_FONT := preload("res://assets/fonts/Monocraft.ttf")

var _root: Control
var _resume_button: Button
var _settings_root: Control
var _is_paused := false
var _name_section: VBoxContainer
var _card_section: VBoxContainer
var _card_pixfy: CheckButton
var _card_status: Label
var _card_dialog: FileDialog
var _card_web_cb
var _name_edit: LineEdit
var _name_save: Button
var _name_status: Label
var _name_saving := false

# Menus are laid out for a 1600x900 desktop canvas, on touch devices, use a
# theme with bumped-up font sizes/constants/stylebox margins instead of
# Control.scale (a transform just blurs the already-rasterized pixel font
# instead of actually growing it, reads as the wrong font entirely).
func _touch_theme() -> Theme:
	# touch_menu_theme always hands back a duplicate, so swapping the default
	# font here is safe and never touches the shared THEME resource.
	var t := Settings.touch_menu_theme(THEME)
	t.default_font = OLD_MENU_FONT
	return t

func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_build_settings_ui()
	_root.visible = false
	NetworkManager.name_result.connect(_on_name_result)
	Settings.font_scale_changed.connect(func():
		_root.theme = _touch_theme()
		_settings_root.theme = _touch_theme())

func _make_modal(title: String, width: float) -> Dictionary:
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = title
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(width, 0)
	wrap.add_child(panel)

	var accents := Control.new()
	accents.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(accents)
	for i in 4:
		var dot := ColorRect.new()
		dot.color = ACCENT_GOLD
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var right := i % 2 == 1
		var bottom := i >= 2
		dot.anchor_left = 1.0 if right else 0.0
		dot.anchor_right = dot.anchor_left
		dot.anchor_top = 1.0 if bottom else 0.0
		dot.anchor_bottom = dot.anchor_top
		dot.offset_left = -17.0 if right else 9.0
		dot.offset_right = dot.offset_left + 8.0
		dot.offset_top = -17.0 if bottom else 9.0
		dot.offset_bottom = dot.offset_top + 8.0
		accents.add_child(dot)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 30)
	margin.add_theme_constant_override("margin_right", 30)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_bottom", 24)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	margin.add_child(body)

	return {"root": wrap, "body": body}

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = _touch_theme()
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var modal := _make_modal("MENU", 400 * Settings.menu_scale_factor())
	center.add_child(modal["root"])
	var body: VBoxContainer = modal["body"]

	_resume_button = Button.new()
	_resume_button.text = "Resume"
	_resume_button.pressed.connect(resume_game)
	body.add_child(_resume_button)

	var settings_button := Button.new()
	settings_button.text = "Settings"
	settings_button.pressed.connect(open_settings)
	body.add_child(settings_button)

	var character_button := Button.new()
	character_button.text = "Customise Look"
	character_button.pressed.connect(_on_character)
	body.add_child(character_button)

	# Replay the first-run arrival flow (cinematic → Pixo → naming → first Trial)
	# on demand, runs regardless of the saved onboarding step, so no reset needed.
	var replay_button := Button.new()
	replay_button.text = "Replay intro"
	replay_button.pressed.connect(_replay_onboarding)
	body.add_child(replay_button)

	var menu_button := Button.new()
	menu_button.text = "Quit to Main Menu"
	menu_button.theme_type_variation = &"GreyButton"
	menu_button.pressed.connect(_quit_to_menu)
	body.add_child(menu_button)

func _build_settings_ui() -> void:
	_settings_root = Control.new()
	_settings_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_settings_root.theme = _touch_theme()
	_settings_root.visible = false
	add_child(_settings_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.9)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_settings_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_settings_root.add_child(center)

	var modal := _make_modal("SETTINGS", 500 * Settings.menu_scale_factor())
	center.add_child(modal["root"])
	var body: VBoxContainer = modal["body"]

	var music_check := CheckButton.new()
	music_check.text = "Music"
	music_check.button_pressed = Settings.music_enabled
	music_check.toggled.connect(Settings.set_music_enabled)
	body.add_child(music_check)

	var daynight_check := CheckButton.new()
	daynight_check.text = "Day/night cycle"
	daynight_check.button_pressed = Settings.day_night_enabled
	daynight_check.toggled.connect(Settings.set_day_night_enabled)
	body.add_child(daynight_check)

	var vol_label := Label.new()
	vol_label.text = "Music volume"
	vol_label.theme_type_variation = &"InfoText"
	body.add_child(vol_label)
	var vol := HSlider.new()
	vol.min_value = 0.0
	vol.max_value = 1.0
	vol.step = 0.05
	vol.value = Settings.music_volume
	vol.value_changed.connect(Settings.set_music_volume)
	body.add_child(vol)

	var font_label := Label.new()
	font_label.text = "UI font size  (%d%%)" % int(round(Settings.font_scale * 100))
	font_label.theme_type_variation = &"InfoText"
	body.add_child(font_label)
	var font_slider := HSlider.new()
	font_slider.min_value = 1.0
	font_slider.max_value = 1.6
	font_slider.step = 0.05
	font_slider.value = Settings.font_scale
	font_slider.value_changed.connect(func(v: float):
		Settings.set_font_scale(v)
		font_label.text = "UI font size  (%d%%)" % int(round(Settings.font_scale * 100)))
	body.add_child(font_slider)

	var zoom_label := Label.new()
	zoom_label.text = "Camera zoom  (%d%%)" % int(round(Settings.zoom_level * 100))
	zoom_label.theme_type_variation = &"InfoText"
	body.add_child(zoom_label)
	var zoom_row := HBoxContainer.new()
	zoom_row.add_theme_constant_override("separation", 10)
	body.add_child(zoom_row)
	var zoom_slider := HSlider.new()
	zoom_slider.min_value = 0.6
	zoom_slider.max_value = 1.4
	zoom_slider.step = 0.05
	zoom_slider.value = Settings.zoom_level
	zoom_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	zoom_slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	zoom_slider.value_changed.connect(func(v: float):
		Settings.set_zoom_level(v)
		zoom_label.text = "Camera zoom  (%d%%)" % int(round(Settings.zoom_level * 100)))
	zoom_row.add_child(zoom_slider)
	var zoom_reset := Button.new()
	zoom_reset.theme_type_variation = &"GreyButton"
	zoom_reset.text = "Reset"
	zoom_reset.pressed.connect(func():
		Settings.reset_zoom()
		zoom_slider.set_value_no_signal(1.0)
		zoom_label.text = "Camera zoom  (100%)")
	zoom_row.add_child(zoom_reset)

	_name_section = VBoxContainer.new()
	_name_section.add_theme_constant_override("separation", 8)
	body.add_child(_name_section)

	var name_label := Label.new()
	name_label.text = "Display name"
	name_label.theme_type_variation = &"InfoText"
	_name_section.add_child(name_label)

	var name_row := HBoxContainer.new()
	name_row.add_theme_constant_override("separation", 8)
	_name_section.add_child(name_row)

	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Your display name"
	_name_edit.max_length = 24
	_name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_edit.text_submitted.connect(func(_t): _submit_name())
	name_row.add_child(_name_edit)

	_name_save = Button.new()
	_name_save.text = "Save"
	_name_save.pressed.connect(_submit_name)
	name_row.add_child(_name_save)

	_name_status = Label.new()
	_name_status.add_theme_font_size_override("font_size", 13)
	_name_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_name_status.visible = false
	_name_section.add_child(_name_status)

	_card_section = VBoxContainer.new()
	_card_section.add_theme_constant_override("separation", 8)
	body.add_child(_card_section)

	var card_label := Label.new()
	card_label.text = "Player card photo"
	card_label.theme_type_variation = &"InfoText"
	_card_section.add_child(card_label)

	var card_row := HBoxContainer.new()
	card_row.add_theme_constant_override("separation", 8)
	_card_section.add_child(card_row)

	var upload_btn := Button.new()
	upload_btn.text = "Upload photo"
	upload_btn.pressed.connect(_pick_card_photo)
	card_row.add_child(upload_btn)

	_card_pixfy = CheckButton.new()
	_card_pixfy.text = "Pixfy it"
	_card_pixfy.button_pressed = true
	_card_pixfy.toggled.connect(_on_pixfy_toggled)
	card_row.add_child(_card_pixfy)

	_card_status = Label.new()
	_card_status.add_theme_font_size_override("font_size", 13)
	_card_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_card_status.visible = false
	_card_section.add_child(_card_status)

	_card_dialog = FileDialog.new()
	_card_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	_card_dialog.access = FileDialog.ACCESS_FILESYSTEM
	_card_dialog.use_native_dialog = true
	_card_dialog.filters = PackedStringArray(["*.png,*.jpg,*.jpeg,*.webp ; Images"])
	_card_dialog.file_selected.connect(_upload_card_photo)
	add_child(_card_dialog)

	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 6)
	body.add_child(spacer)

	var back := Button.new()
	back.text = "Back"
	back.theme_type_variation = &"GreyButton"
	back.pressed.connect(_close_settings)
	body.add_child(back)

func open_settings() -> void:
	_root.visible = false
	_name_section.visible = NetworkManager.session_token != ""
	_card_section.visible = NetworkManager.session_token != ""
	_name_edit.text = NetworkManager.display_name
	_name_status.visible = false
	_card_status.visible = false
	_name_saving = false
	_name_save.disabled = false
	_name_save.text = "Save"
	_settings_root.visible = true
	if NetworkManager.session_token != "":
		_card_api(HTTPClient.METHOD_GET, "/api/profile/card", "", func(code, json):
			if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
				_card_pixfy.set_pressed_no_signal(bool(json.get("pixelate", true))))

func _pick_card_photo() -> void:
	if OS.has_feature("web"):
		_card_web_pick()
		return
	var filters := PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp ; Images"])
	var start_dir := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES)
	if start_dir == "":
		start_dir = OS.get_environment("HOME")
	var native_cb := func(ok: bool, paths: PackedStringArray, _filter: int):
		if ok and not paths.is_empty():
			_upload_card_photo(paths[0])
	if DisplayServer.has_method("file_dialog_show"):
		var err: int = DisplayServer.file_dialog_show(
			"Choose a card photo", start_dir, "", false,
			DisplayServer.FILE_DIALOG_MODE_OPEN_FILE, filters, native_cb)
		if err == OK:
			return
	if start_dir != "":
		_card_dialog.current_dir = start_dir
	_card_dialog.popup_centered(Vector2i(700, 500))

func _card_web_pick() -> void:
	_card_web_cb = JavaScriptBridge.create_callback(_on_card_web_bytes)
	var window = JavaScriptBridge.get_interface("window")
	window.godotCardCallback = _card_web_cb
	JavaScriptBridge.eval("""
	(function(){
		var input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/png,image/jpeg,image/webp';
		input.style.display = 'none';
		input.onchange = function(e){
			var f = e.target.files && e.target.files[0];
			if(!f){ return; }
			var r = new FileReader();
			r.onload = function(){
				var s = String(r.result);
				var b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
				window.godotCardCallback(b64, f.type || 'image/png');
			};
			r.readAsDataURL(f);
		};
		document.body.appendChild(input);
		input.click();
		setTimeout(function(){ input.remove(); }, 60000);
	})();
	""", true)

func _on_card_web_bytes(args: Array) -> void:
	if args.size() < 1:
		return
	var b64 := String(args[0])
	var mime := String(args[1]) if args.size() > 1 else "image/png"
	var bytes := Marshalls.base64_to_raw(b64)
	if bytes.is_empty():
		_card_note("Couldn't read that image.", false)
		return
	_upload_card_bytes(bytes, mime)

func _upload_card_photo(path: String) -> void:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() == 0:
		_card_note("Couldn't read that file.", false)
		return
	var ext := path.get_extension().to_lower()
	var mime := "image/png"
	if ext == "jpg" or ext == "jpeg":
		mime = "image/jpeg"
	elif ext == "webp":
		mime = "image/webp"
	_upload_card_bytes(bytes, mime)

func _upload_card_bytes(bytes: PackedByteArray, mime: String) -> void:
	if bytes.size() > 7_500_000:
		_card_note("That image is too big - keep it under 7 MB.", false)
		return
	_card_note("Uploading…", true)
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/uploads?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_r, code, _h, data):
		req.queue_free()
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			_card_note("Upload failed - try again.", false)
			return
		_card_api(HTTPClient.METHOD_POST, "/api/profile/card-image", JSON.stringify({"url": String(json.get("url", ""))}), func(code2, json2):
			if code2 == 200 and typeof(json2) == TYPE_DICTIONARY and json2.get("ok", false):
				_card_note("Photo saved! It shows on your player card.", true)
			else:
				_card_note("Couldn't save the photo - try again.", false))
	)
	req.request_raw(url, PackedStringArray(["Content-Type: " + mime]), HTTPClient.METHOD_POST, bytes)

func _on_pixfy_toggled(on: bool) -> void:
	_card_api(HTTPClient.METHOD_POST, "/api/profile/card-pixelate", JSON.stringify({"pixelate": on}), func(code, json):
		if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
			_card_note("Pixfy on - pixel-art style." if on else "Pixfy off - original photo.", true)
		else:
			_card_note("Couldn't save that - try again.", false))

func _card_note(text: String, ok: bool) -> void:
	_card_status.text = text
	_card_status.add_theme_color_override("font_color", Color(0.45, 0.85, 0.5) if ok else PixlTheme.color("bad"))
	_card_status.visible = true

func _card_api(method: int, path: String, body: String, cb: Callable) -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path + "?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_r, code, _h, data):
		req.queue_free()
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		cb.call(code, json)
	)
	req.request(url, PackedStringArray(["Content-Type: application/json"]), method, body)

func _close_settings() -> void:
	_settings_root.visible = false
	_root.visible = _is_paused

func _submit_name() -> void:
	var name := _name_edit.text.strip_edges()
	if name == "" or name == NetworkManager.display_name:
		_name_status.visible = false
		return
	_name_saving = true
	_name_save.disabled = true
	_name_save.text = "Saving…"
	NetworkManager.submit_display_name(name)

func _on_name_result(ok: bool, text: String) -> void:
	if not _name_saving:
		return
	_name_saving = false
	_name_save.disabled = false
	_name_save.text = "Save"
	_name_status.visible = true
	if ok:
		_name_edit.text = text
		_name_status.add_theme_color_override("font_color", ACCENT_GOLD)
		_name_status.text = "Name updated!"
	else:
		_name_status.add_theme_color_override("font_color", PixlTheme.color("bad"))
		_name_status.text = text

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		if _settings_root.visible:
			_close_settings()
			get_viewport().set_input_as_handled()
			return
		_toggle()
		get_viewport().set_input_as_handled()

func _toggle() -> void:
	if _is_paused:
		resume_game()
		return
	var current := get_tree().current_scene
	if current == null:
		return
	var scene_name := current.scene_file_path.get_file().get_basename()
	if GAMEPLAY_SCENES.has(scene_name):
		pause_game()

func is_open() -> bool:
	return _is_paused or _settings_root.visible

func pause_game() -> void:
	if _is_paused:
		return
	_is_paused = true
	global.push_ui_blocker()
	_root.visible = true
	_resume_button.grab_focus()

func resume_game() -> void:
	if not _is_paused:
		return
	_is_paused = false
	global.pop_ui_blocker()
	_settings_root.visible = false
	_root.visible = false

func _replay_onboarding() -> void:
	var scene := get_tree().current_scene
	resume_game()
	if scene == null:
		return
	var flow := ONBOARDING.new()
	scene.add_child(flow)
	flow.finished.connect(func(): flow.queue_free())
	flow.start()

func _on_character() -> void:
	var current := get_tree().current_scene
	if current and current.scene_file_path != "":
		global.editor_return_scene = current.scene_file_path
	resume_game()
	get_tree().change_scene_to_file("res://scenes/character_editor.tscn")

func _quit_to_menu() -> void:
	resume_game()
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
