extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
# The HUD keeps the original pixel font (Monocraft) even though the rest of
# the game moved to Pixelify Sans — everything else stays on the theme default.
const HUD_FONT := preload("res://assets/fonts/Monocraft.ttf")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]

var _root: Control
var _name_label: Label
var _online_label: Label
var _clock_dot: ColorRect
var _clock_label: Label
var _inbox_dot: ColorRect
var _inbox_label: Label
var _pixels_label: Label
var _hours_label: Label
var _event_card: PanelContainer
var _event_label: Label
## The stack of [key] hint chips. Starts hidden and toggles on F3 so the HUD is
## quiet by default; the wallet and clock are not in here and always show.
var _shortcuts: VBoxContainer
var _players := {}
var _your_id := ""
var _list_root: Control
var _list_box: VBoxContainer
var _tx_root: Control
var _tx_box: VBoxContainer
var _scaled: Array = []
var _hud_theme: Theme

# A copy of the shared theme with the HUD's fonts pinned back to Monocraft —
# main_theme.tres itself stays on Pixelify Sans for everything else (menus,
# dialogue, world-space prompts), this override only ever touches the HUD.
func _make_hud_theme() -> Theme:
	var t: Theme = THEME.duplicate()
	t.default_font = HUD_FONT
	t.set_font("font", "SubText", HUD_FONT)
	t.set_font("font", "TitlePlateText", HUD_FONT)
	return t

func _ssize(c: Control, base: int) -> void:
	c.add_theme_font_size_override("font_size", Settings.fs(base))
	_scaled.append([c, base])

func _apply_font_scale() -> void:
	for entry in _scaled:
		var c: Control = entry[0]
		if is_instance_valid(c):
			c.add_theme_font_size_override("font_size", Settings.fs(entry[1]))

func _ready() -> void:
	layer = 95
	_hud_theme = _make_hud_theme()
	_build_ui()
	_build_list_ui()
	NetworkManager.logged_in.connect(_on_logged_in)
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_left.connect(_on_player_left)
	Settings.font_scale_changed.connect(_apply_font_scale)
	var wallet_timer := Timer.new()
	wallet_timer.wait_time = 45.0
	wallet_timer.autostart = true
	wallet_timer.timeout.connect(_fetch_wallet)
	add_child(wallet_timer)
	_fetch_wallet()
	var event_timer := Timer.new()
	event_timer.wait_time = 120.0
	event_timer.autostart = true
	event_timer.timeout.connect(_fetch_events)
	add_child(event_timer)
	_fetch_events()

func _process(_delta: float) -> void:
	var in_game := _in_gameplay() and not global.ui_blocked()
	_root.visible = in_game
	if not in_game:
		_list_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	# Mac keyboards map bare F-keys to system functions by default, so F3 never
	# reaches the app there; Cmd+K is the Mac-only alternate binding.
	var is_shortcuts_key: bool = event.keycode == KEY_F3
	if OS.get_name() == "macOS":
		is_shortcuts_key = is_shortcuts_key or (event.keycode == KEY_K and event.meta_pressed)
	if is_shortcuts_key:
		if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
			_shortcuts.visible = not _shortcuts.visible
			get_viewport().set_input_as_handled()
	elif event.keycode == KEY_TAB:
		if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
			_toggle_list()
			get_viewport().set_input_as_handled()
	elif event.keycode == KEY_ESCAPE and _tx_root != null and _tx_root.visible:
		_tx_root.visible = false
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_ESCAPE and _list_root.visible:
		_list_root.visible = false
		get_viewport().set_input_as_handled()

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.theme = _hud_theme
	_root.visible = false
	add_child(_root)

	var column := VBoxContainer.new()
	column.position = Vector2(12, 12)
	column.add_theme_constant_override("separation", 6)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(column)

	_event_card = PanelContainer.new()
	_event_card.theme_type_variation = &"HudPanel"
	_event_card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_event_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_event_card.visible = false
	_event_card.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_event_card.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_event_card.offset_top = 10.0
	_root.add_child(_event_card)
	var event_margin := MarginContainer.new()
	event_margin.add_theme_constant_override("margin_left", 14)
	event_margin.add_theme_constant_override("margin_right", 14)
	event_margin.add_theme_constant_override("margin_top", 5)
	event_margin.add_theme_constant_override("margin_bottom", 5)
	_event_card.add_child(event_margin)
	_event_label = Label.new()
	_event_label.add_theme_color_override("font_color", PixlTheme.color("gold"))
	_ssize(_event_label, 15)
	event_margin.add_child(_event_label)

	var wallet_card := PanelContainer.new()
	wallet_card.theme_type_variation = &"HudPanel"
	wallet_card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	wallet_card.custom_minimum_size = Vector2(200, 0)
	wallet_card.mouse_filter = Control.MOUSE_FILTER_STOP
	wallet_card.tooltip_text = "Click for your pixel history"
	wallet_card.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_open_tx_history())
	column.add_child(wallet_card)

	var wallet_margin := MarginContainer.new()
	wallet_margin.add_theme_constant_override("margin_left", 10)
	wallet_margin.add_theme_constant_override("margin_right", 10)
	wallet_margin.add_theme_constant_override("margin_top", 6)
	wallet_margin.add_theme_constant_override("margin_bottom", 6)
	wallet_card.add_child(wallet_margin)

	var wallet_box := VBoxContainer.new()
	wallet_box.add_theme_constant_override("separation", 1)
	wallet_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_margin.add_child(wallet_box)

	var pixels_row := HBoxContainer.new()
	pixels_row.add_theme_constant_override("separation", 8)
	pixels_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_box.add_child(pixels_row)

	var coin := TextureRect.new()
	coin.texture = load("res://assets/ui/pixel_currency_red.png")
	coin.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	coin.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	coin.custom_minimum_size = Vector2(30, 30)
	coin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	coin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pixels_row.add_child(coin)

	_pixels_label = Label.new()
	_ssize(_pixels_label, 26)
	_pixels_label.add_theme_color_override("font_color", PixlTheme.color("gold"))
	_pixels_label.text = "- pixels"
	pixels_row.add_child(_pixels_label)

	_hours_label = Label.new()
	_hours_label.theme_type_variation = &"SubText"
	_ssize(_hours_label, 17)
	_hours_label.text = "0h approved"
	wallet_box.add_child(_hours_label)

	var card := PanelContainer.new()
	card.theme_type_variation = &"HudPanel"
	card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	card.custom_minimum_size = Vector2(200, 0)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(card)

	var card_margin := MarginContainer.new()
	card_margin.add_theme_constant_override("margin_left", 6)
	card_margin.add_theme_constant_override("margin_right", 6)
	card_margin.add_theme_constant_override("margin_top", 2)
	card_margin.add_theme_constant_override("margin_bottom", 3)
	card.add_child(card_margin)

	_name_label = Label.new()
	_name_label.theme_type_variation = &"SubText"
	_ssize(_name_label, 16)
	_name_label.text = NetworkManager.display_name if NetworkManager.display_name != "" else "Player"
	_name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	card_margin.add_child(_name_label)

	_shortcuts = VBoxContainer.new()
	_shortcuts.add_theme_constant_override("separation", 6)
	_shortcuts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_shortcuts.visible = false
	column.add_child(_shortcuts)

	var chip := PanelContainer.new()
	chip.theme_type_variation = &"HudPanel"
	chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	chip.mouse_filter = Control.MOUSE_FILTER_STOP
	chip.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
				_toggle_list())
	_shortcuts.add_child(chip)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	chip.add_child(row)

	var dot := ColorRect.new()
	dot.color = PixlTheme.color("good")
	dot.custom_minimum_size = Vector2(8, 8)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(dot)

	_online_label = Label.new()
	_ssize(_online_label, 16)
	_online_label.text = "1 online  [Tab]"
	_online_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(_online_label)

	var friends_chip := PanelContainer.new()
	friends_chip.theme_type_variation = &"HudPanel"
	friends_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	friends_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	friends_chip.mouse_filter = Control.MOUSE_FILTER_STOP
	friends_chip.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			if FriendsHud.is_open():
				FriendsHud.close()
			elif not ChatHud.is_typing() and not Dialogue.is_open and not global.ui_blocked():
				FriendsHud.open())
	_shortcuts.add_child(friends_chip)

	var friends_row := HBoxContainer.new()
	friends_row.add_theme_constant_override("separation", 7)
	friends_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	friends_chip.add_child(friends_row)

	var friends_dot := ColorRect.new()
	friends_dot.color = PixlTheme.color("gold")
	friends_dot.custom_minimum_size = Vector2(8, 8)
	friends_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	friends_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	friends_row.add_child(friends_dot)

	var friends_label := Label.new()
	_ssize(friends_label, 16)
	friends_label.text = "Friends  [F]"
	friends_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	friends_row.add_child(friends_label)

	var shop_chip := PanelContainer.new()
	shop_chip.theme_type_variation = &"HudPanel"
	shop_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	shop_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	shop_chip.mouse_filter = Control.MOUSE_FILTER_STOP
	shop_chip.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
				WebPages.open("shop"))
	_shortcuts.add_child(shop_chip)

	var shop_row := HBoxContainer.new()
	shop_row.add_theme_constant_override("separation", 7)
	shop_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shop_chip.add_child(shop_row)

	var shop_dot := ColorRect.new()
	shop_dot.color = PixlTheme.color("bad")
	shop_dot.custom_minimum_size = Vector2(8, 8)
	shop_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	shop_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shop_row.add_child(shop_dot)

	var shop_label := Label.new()
	_ssize(shop_label, 16)
	shop_label.text = "Shop  [B]"
	shop_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shop_row.add_child(shop_label)

	var quest_chip := PanelContainer.new()
	quest_chip.theme_type_variation = &"HudPanel"
	quest_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	quest_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	quest_chip.mouse_filter = Control.MOUSE_FILTER_STOP
	quest_chip.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
				WebPages.open("quests"))
	_shortcuts.add_child(quest_chip)

	var quest_row := HBoxContainer.new()
	quest_row.add_theme_constant_override("separation", 7)
	quest_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	quest_chip.add_child(quest_row)

	var quest_dot := ColorRect.new()
	quest_dot.color = PixlTheme.color("gold")
	quest_dot.custom_minimum_size = Vector2(8, 8)
	quest_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	quest_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	quest_row.add_child(quest_dot)

	var quest_label := Label.new()
	_ssize(quest_label, 16)
	quest_label.text = "Trials  [J]"
	quest_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	quest_row.add_child(quest_label)

	var inbox_chip := PanelContainer.new()
	inbox_chip.theme_type_variation = &"HudPanel"
	inbox_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	inbox_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	inbox_chip.mouse_filter = Control.MOUSE_FILTER_STOP
	inbox_chip.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			if InboxHud.is_open():
				InboxHud.close()
			elif not ChatHud.is_typing() and not Dialogue.is_open and not global.ui_blocked():
				InboxHud.open())
	_shortcuts.add_child(inbox_chip)

	var inbox_row := HBoxContainer.new()
	inbox_row.add_theme_constant_override("separation", 7)
	inbox_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inbox_chip.add_child(inbox_row)

	_inbox_dot = ColorRect.new()
	_inbox_dot.custom_minimum_size = Vector2(8, 8)
	_inbox_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_inbox_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inbox_row.add_child(_inbox_dot)

	_inbox_label = Label.new()
	_ssize(_inbox_label, 16)
	_inbox_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inbox_row.add_child(_inbox_label)

	_update_inbox(InboxHud.unread_count)
	InboxHud.unread_changed.connect(_update_inbox)

	var clock_chip := PanelContainer.new()
	clock_chip.theme_type_variation = &"HudPanel"
	clock_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	clock_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	clock_chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(clock_chip)

	var clock_row := HBoxContainer.new()
	clock_row.add_theme_constant_override("separation", 7)
	clock_chip.add_child(clock_row)

	_clock_dot = ColorRect.new()
	_clock_dot.custom_minimum_size = Vector2(8, 8)
	_clock_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_clock_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	clock_row.add_child(_clock_dot)

	_clock_label = Label.new()
	_ssize(_clock_label, 16)
	clock_row.add_child(_clock_label)

	_update_clock()
	var clock_timer := Timer.new()
	clock_timer.wait_time = 5.0
	clock_timer.autostart = true
	clock_timer.timeout.connect(_update_clock)
	add_child(clock_timer)

func _update_inbox(unread: int) -> void:
	if unread > 0:
		_inbox_dot.color = PixlTheme.color("gold")
		_inbox_label.text = "Inbox  [N]  •  %d new" % unread
		_inbox_label.add_theme_color_override("font_color", PixlTheme.color("gold"))
	else:
		_inbox_dot.color = Color(0.62, 0.58, 0.5)
		_inbox_label.text = "Inbox  [N]"
		_inbox_label.remove_theme_color_override("font_color")

func _update_clock() -> void:
	var phase := global.day_phase()
	var td := Time.get_time_dict_from_system()
	_clock_dot.color = phase["color"]
	_clock_label.text = "%s %02d:%02d  •  %s" % [phase["name"], td.hour, td.minute, phase["next"]]

func _open_tx_history() -> void:
	if _tx_root == null:
		_build_tx_ui()
	_tx_root.visible = true
	for child in _tx_box.get_children():
		child.queue_free()
	var loading := Label.new()
	loading.theme_type_variation = &"SubText"
	loading.text = "Loading…"
	_tx_box.add_child(loading)
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/profile/transactions?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if not _tx_root.visible:
			return
		for child in _tx_box.get_children():
			child.queue_free()
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			var err := Label.new()
			err.theme_type_variation = &"SubText"
			err.text = "Couldn't load your history."
			_tx_box.add_child(err)
			return
		var txs: Array = json.get("transactions", [])
		if txs.is_empty():
			var none := Label.new()
			none.theme_type_variation = &"SubText"
			none.text = "No pixel activity yet - ship a project!"
			_tx_box.add_child(none)
			return
		for t in txs:
			_tx_box.add_child(_tx_row(t))
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)

func _tx_reason(reason: String) -> String:
	match reason:
		"project_approved":
			return "Project approved"
		"review_reverted":
			return "Verdict reverted"
		"manual_deduction":
			return "Adjusted by the Pixl team"
		"manual_grant":
			return "Granted by the Pixl team"
	return reason

func _tx_row(t: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var amount := int(t.get("amount", 0))
	var amt := Label.new()
	amt.text = ("+%d" % amount) if amount >= 0 else str(amount)
	amt.custom_minimum_size = Vector2(70, 0)
	amt.add_theme_color_override("font_color", PixlTheme.color("good") if amount >= 0 else PixlTheme.color("bad"))
	row.add_child(amt)
	var what := Label.new()
	var reason := _tx_reason(String(t.get("reason", "")))
	var project := String(t.get("project", "")).strip_edges()
	what.text = reason + (" · " + project if project != "" else "")
	what.clip_text = true
	what.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(what)
	var when := Label.new()
	when.theme_type_variation = &"SubText"
	when.text = String(t.get("created_at", "")).substr(0, 10)
	row.add_child(when)
	return row

func _build_tx_ui() -> void:
	_tx_root = Control.new()
	_tx_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_tx_root.theme = _hud_theme
	_tx_root.visible = false
	add_child(_tx_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_tx_root.add_child(dim)

	var close_catch := Button.new()
	close_catch.flat = true
	close_catch.set_anchors_preset(Control.PRESET_FULL_RECT)
	close_catch.pressed.connect(func(): _tx_root.visible = false)
	_tx_root.add_child(close_catch)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tx_root.add_child(center)

	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)
	center.add_child(wrap)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = "PIXEL HISTORY"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(480, 0)
	wrap.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_bottom", 22)
	panel.add_child(margin)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 340)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	margin.add_child(scroll)

	_tx_box = VBoxContainer.new()
	_tx_box.add_theme_constant_override("separation", 8)
	_tx_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_tx_box)

func _fetch_wallet() -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/profile/wallet?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200:
			return
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		# pxPerHour ramps continuously off RE, so it arrives fractional - round
		# rather than let int() truncate 65.7 down to 65.
		_set_wallet(
			float(json.get("pixels", 0)),
			float(json.get("approvedHours", 0)),
			int(json.get("level", 0)),
			int(round(float(json.get("pxPerHour", 0)))),
			float(json.get("re", 0)),
		)
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)

func _fetch_events() -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/events/active?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200:
			return
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		_set_events(json.get("events", []))
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)

func _set_events(events: Array) -> void:
	if _event_label == null:
		return
	var parts := PackedStringArray()
	for e in events:
		var ev_name := String(e.get("name", ""))
		if ev_name == "":
			continue
		match String(e.get("type", "")):
			"community_goal":
				parts.append("%s: %d/%d ships (+%d%%)" % [ev_name, int(e.get("progress", 0)), int(e.get("target", 0)), int(e.get("bonus_pct", 0))])
			"bounty":
				parts.append("%s: +%d px bounty" % [ev_name, int(e.get("reward", 0))])
			_:
				parts.append(ev_name)
	if parts.is_empty():
		_event_card.visible = false
		return
	_event_label.text = "EVENT  " + "  ·  ".join(parts)
	_event_card.visible = true

func _set_wallet(pixels: float, hours: float, level: int = 0, px_rate: int = 0, re: float = 0.0) -> void:
	if _pixels_label == null:
		return
	_pixels_label.text = "%s pixels" % _fmt_amount(pixels)
	if px_rate > 0:
		_hours_label.text = "%sh · LVL %d · %s RE · %d px/h" % [
			_fmt_amount(hours), level, _fmt_amount(re), px_rate,
		]
	else:
		_hours_label.text = "%sh approved" % _fmt_amount(hours)

func _fmt_amount(v: float) -> String:
	if absf(v - roundf(v)) < 0.05:
		return str(int(round(v)))
	return "%.1f" % v

func _build_list_ui() -> void:
	_list_root = Control.new()
	_list_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_list_root.theme = _hud_theme
	_list_root.visible = false
	add_child(_list_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_list_root.add_child(dim)

	var close_catch := Button.new()
	close_catch.flat = true
	close_catch.set_anchors_preset(Control.PRESET_FULL_RECT)
	close_catch.pressed.connect(func(): _list_root.visible = false)
	_list_root.add_child(close_catch)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_list_root.add_child(center)

	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)
	center.add_child(wrap)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = "PLAYERS ONLINE"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	# Wide enough that a typical display name plus the "(you)" tag and the View
	# button sit on one line; longer names trim with an ellipsis.
	panel.custom_minimum_size = Vector2(460, 0)
	wrap.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_bottom", 22)
	panel.add_child(margin)

	_list_box = VBoxContainer.new()
	_list_box.add_theme_constant_override("separation", 8)
	margin.add_child(_list_box)

func _toggle_list() -> void:
	_list_root.visible = not _list_root.visible
	if _list_root.visible:
		_refresh_list()

func _refresh_list() -> void:
	for child in _list_box.get_children():
		child.queue_free()
	var entries: Array = []
	for uid in _players:
		entries.append([String(_players[uid]), false, String(uid)])
	entries.sort_custom(func(a, b): return String(a[0]).naturalnocasecmp_to(String(b[0])) < 0)
	var me := NetworkManager.display_name if NetworkManager.display_name != "" else "Player"
	entries.push_front([me, true, _your_id])
	for entry in entries:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var dot := ColorRect.new()
		dot.color = PixlTheme.color("good")
		dot.custom_minimum_size = Vector2(8, 8)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(dot)
		var label := Label.new()
		label.text = String(entry[0])
		if entry[1]:
			label.add_theme_color_override("font_color", PixlTheme.color("gold"))
		# One row per player: clip_text drops the label's full-text minimum width
		# so a long name trims with an ellipsis instead of wrapping and shoving
		# the "(you)" tag onto a line of its own.
		label.clip_text = true
		label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(label)
		if entry[1]:
			var you := Label.new()
			you.text = "(you)"
			you.add_theme_color_override("font_color", PixlTheme.color("gold"))
			you.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(you)
		var pid := String(entry[2])
		if pid != "":
			var view := Button.new()
			view.theme_type_variation = &"StepButton"
			view.text = "View"
			_ssize(view, 14)
			view.pressed.connect(func():
				_list_root.visible = false
				WebPages.open("explore#player=" + pid))
			row.add_child(view)
		_list_box.add_child(row)

func _on_logged_in(display_name: String) -> void:
	_name_label.text = display_name if display_name != "" else "Player"
	_fetch_wallet()

func _on_scene_init(your_id: String, _pos: Vector2, others: Array, _spawn_at_default: bool) -> void:
	_your_id = your_id
	_players.clear()
	for p in others:
		var uid := String(p["userId"])
		if uid != your_id:
			_players[uid] = String(p.get("displayName", "Player"))
	_update_online()
	_fetch_wallet()

func _on_player_joined(user_id: String, name: String, _pos: Vector2, _dir: String, _skin: String) -> void:
	_players[user_id] = name
	_update_online()

func _on_player_left(user_id: String) -> void:
	_players.erase(user_id)
	_update_online()

func _update_online() -> void:
	_online_label.text = "%d online  [Tab]" % (1 + _players.size())
	if _list_root != null and _list_root.visible:
		_refresh_list()

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())
