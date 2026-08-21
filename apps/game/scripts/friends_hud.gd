extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const COLOR_ONLINE := Color(0.290196, 0.870588, 0.501961)
const COLOR_OFFLINE := Color(0.788235, 0.694118, 0.54902)
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)

var _root: Control
var _list: VBoxContainer
var _status_label: Label
var _search_edit: LineEdit
var _search_results: VBoxContainer
var _open := false
var _joining := false
var _invites: Array = []

func _readable_theme() -> Theme:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Sans-Serif", "Noto Sans", "DejaVu Sans", "Arial"])
	var t: Theme = THEME.duplicate(true)
	t.default_font = f
	t.default_font_size = Settings.fs(20)
	return t

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false
	NetworkManager.lobby_joined.connect(_on_lobby_joined)
	NetworkManager.lobby_denied.connect(_on_lobby_denied)
	NetworkManager.village_invited.connect(_on_village_invited)

func _unhandled_input(event: InputEvent) -> void:
	if _open and event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F:
		if _open:
			close()
			get_viewport().set_input_as_handled()
			return
		if ChatHud.is_typing() or Dialogue.is_open or global.ui_blocked():
			return
		_toggle()
		get_viewport().set_input_as_handled()

func is_open() -> bool:
	return _open

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current and GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func open() -> void:
	if _open:
		return
	_open = true
	_joining = false
	global.push_ui_blocker()
	_root.visible = true
	_search_edit.clear()
	_clear_search_results()
	refresh()

func close() -> void:
	if not _open:
		return
	_open = false
	global.pop_ui_blocker()
	_root.visible = false

func refresh() -> void:
	_status_label.text = ""
	# Pull village invites first, then the friends list renders both together.
	_api(HTTPClient.METHOD_GET, "/api/village/invites", {}, func(code, json):
		if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
			_invites = json.get("invites", [])
		else:
			_invites = []
		_api(HTTPClient.METHOD_GET, "/api/friends", {}, _on_list)
	)

func _on_village_invited(_invite_id: int, _from_name: String, _lobby_name: String) -> void:
	if _open:
		refresh()

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = _readable_theme()
	Settings.font_scale_changed.connect(func(): _root.theme = _readable_theme())
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)
	center.add_child(wrap)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = "FRIENDS"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	wrap.add_child(panel)

	var accents := Control.new()
	accents.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(accents)
	for i in 4:
		var corner := ColorRect.new()
		corner.color = ACCENT_GOLD
		corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var right := i % 2 == 1
		var bottom := i >= 2
		corner.anchor_left = 1.0 if right else 0.0
		corner.anchor_right = corner.anchor_left
		corner.anchor_top = 1.0 if bottom else 0.0
		corner.anchor_bottom = corner.anchor_top
		corner.offset_left = -17.0 if right else 9.0
		corner.offset_right = corner.offset_left + 8.0
		corner.offset_top = -17.0 if bottom else 9.0
		corner.offset_bottom = corner.offset_top + 8.0
		accents.add_child(corner)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 30)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_right", 30)
	margin.add_theme_constant_override("margin_bottom", 24)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	margin.add_child(body)

	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 8)
	body.add_child(search_row)

	_search_edit = LineEdit.new()
	_search_edit.placeholder_text = "Find players by name"
	_search_edit.max_length = 24
	_search_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_search_edit.text_submitted.connect(func(_t): _do_search())
	search_row.add_child(_search_edit)

	var search_button := Button.new()
	search_button.theme_type_variation = &"SmallButton"
	search_button.text = "Search"
	search_button.pressed.connect(_do_search)
	search_row.add_child(search_button)

	var how := Label.new()
	how.theme_type_variation = &"InfoText"
	how.text = "Send a request by searching, or click a player in the world."
	how.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(how)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 320)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroll)

	var scroll_box := VBoxContainer.new()
	scroll_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll_box.add_theme_constant_override("separation", 10)
	scroll.add_child(scroll_box)

	_search_results = VBoxContainer.new()
	_search_results.add_theme_constant_override("separation", 6)
	scroll_box.add_child(_search_results)

	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 6)
	scroll_box.add_child(_list)

	_status_label = Label.new()
	_status_label.theme_type_variation = &"StatusText"
	_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(_status_label)

	var close_button := Button.new()
	close_button.theme_type_variation = &"GreyButton"
	close_button.text = "Close"
	close_button.pressed.connect(close)
	body.add_child(close_button)

func _on_list(code: int, json: Variant) -> void:
	for child in _list.get_children():
		child.queue_free()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_list.add_child(_muted("Couldn't load your friends list."))
		return
	var friends: Array = json.get("friends", [])
	var incoming: Array = json.get("incoming", [])
	var outgoing: Array = json.get("outgoing", [])
	if not _invites.is_empty():
		_list.add_child(_header("VILLAGE INVITES"))
		for inv in _invites:
			_list.add_child(_invite_row(inv))
	if friends.is_empty() and incoming.is_empty() and outgoing.is_empty():
		if _invites.is_empty():
			_list.add_child(_muted("No friends yet. Search above or click a player in the world!"))
		return
	if not incoming.is_empty():
		_list.add_child(_header("REQUESTS"))
		for f in incoming:
			_list.add_child(_incoming_row(f))
	if not friends.is_empty():
		_list.add_child(_header("FRIENDS"))
		for f in friends:
			_list.add_child(_friend_row(f))
	if not outgoing.is_empty():
		_list.add_child(_header("SENT"))
		for f in outgoing:
			var row := _row_shell()
			var name_label := _row_name(String(f.get("name", "")), COLOR_OFFLINE)
			row_body(row).add_child(name_label)
			var pending := Label.new()
			pending.theme_type_variation = &"InfoText"
			pending.text = "pending"
			row_body(row).add_child(pending)
			_list.add_child(row)

func _header(text: String) -> Label:
	var l := Label.new()
	l.theme_type_variation = &"SubText"
	l.add_theme_color_override("font_color", ACCENT_GOLD)
	l.text = text
	return l

func _row_shell() -> PanelContainer:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	panel.add_child(row)
	return panel

func row_body(shell: PanelContainer) -> HBoxContainer:
	return shell.get_child(0) as HBoxContainer

func _row_name(text: String, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", color)
	l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

func _dot(color: Color) -> ColorRect:
	var d := ColorRect.new()
	d.color = color
	d.custom_minimum_size = Vector2(8, 8)
	d.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return d

func _friend_row(f: Dictionary) -> Control:
	var shell := _row_shell()
	var row := row_body(shell)
	var online: bool = bool(f.get("online", false))
	row.add_child(_dot(COLOR_ONLINE if online else COLOR_OFFLINE))
	row.add_child(_row_name(String(f.get("name", "")), Color(0.956863, 0.890196, 0.760784) if online else COLOR_OFFLINE))
	var lobby_id := String(f.get("lobbyId", ""))
	if online and lobby_id != "" and lobby_id != NetworkManager.current_lobby_id:
		var join := Button.new()
		join.theme_type_variation = &"SmallButton"
		join.text = "Join %s" % String(f.get("lobbyName", "lobby"))
		join.pressed.connect(_on_join.bind(String(f.get("userId", ""))))
		row.add_child(join)
	elif online:
		var where := Label.new()
		where.theme_type_variation = &"InfoText"
		where.text = "in your lobby" if lobby_id != "" else "in the village"
		row.add_child(where)
	# When you're in a village, offer to pull any friend who isn't already there.
	if NetworkManager.current_lobby_id != "" and lobby_id != NetworkManager.current_lobby_id:
		var uid := String(f.get("userId", ""))
		var invite := Button.new()
		invite.theme_type_variation = &"SmallButton"
		invite.text = "Invite"
		invite.pressed.connect(func():
			invite.disabled = true
			invite.text = "Inviting"
			_api(HTTPClient.METHOD_POST, "/api/village/invite", {"userId": uid}, func(code, json):
				var ok: bool = code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false)
				invite.text = "Invited" if ok else "Failed"
				if not ok:
					invite.disabled = false
			)
		)
		row.add_child(invite)
	return shell

func _invite_row(inv: Dictionary) -> Control:
	var shell := _row_shell()
	var row := row_body(shell)
	row.add_child(_dot(COLOR_ONLINE))
	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 0)
	main.add_child(_row_name(String(inv.get("lobbyName", "a village")), Color(0.956863, 0.890196, 0.760784)))
	var from := Label.new()
	from.theme_type_variation = &"InfoText"
	from.text = "from %s" % String(inv.get("fromName", "a friend"))
	main.add_child(from)
	row.add_child(main)
	var invite_id := int(inv.get("id", 0))
	var join := Button.new()
	join.theme_type_variation = &"SmallButton"
	join.text = "Join"
	join.pressed.connect(func():
		_joining = true
		_status_label.text = "Joining %s" % String(inv.get("lobbyName", "the village"))
		NetworkManager.send_accept_village_invite(invite_id)
	)
	row.add_child(join)
	var decline := Button.new()
	decline.theme_type_variation = &"SmallButton"
	decline.text = "Decline"
	decline.pressed.connect(func():
		_api(HTTPClient.METHOD_POST, "/api/village/invite/decline", {"inviteId": invite_id}, func(_c, _j): refresh())
	)
	row.add_child(decline)
	return shell

func _incoming_row(f: Dictionary) -> Control:
	var shell := _row_shell()
	var row := row_body(shell)
	row.add_child(_dot(ACCENT_GOLD))
	row.add_child(_row_name(String(f.get("name", "")), Color(0.956863, 0.890196, 0.760784)))
	var uid := String(f.get("userId", ""))
	var accept := Button.new()
	accept.theme_type_variation = &"SmallButton"
	accept.text = "Accept"
	accept.pressed.connect(func():
		_api(HTTPClient.METHOD_POST, "/api/friends/accept", {"userId": uid}, func(_c, _j): refresh())
	)
	row.add_child(accept)
	var decline := Button.new()
	decline.theme_type_variation = &"SmallButton"
	decline.text = "Decline"
	decline.pressed.connect(func():
		_api(HTTPClient.METHOD_POST, "/api/friends/remove", {"userId": uid}, func(_c, _j): refresh())
	)
	row.add_child(decline)
	return shell

func _clear_search_results() -> void:
	for child in _search_results.get_children():
		child.queue_free()

func _do_search() -> void:
	_clear_search_results()
	var q := _search_edit.text.strip_edges()
	if q.length() < 2:
		_search_results.add_child(_muted("Type at least 2 characters."))
		return
	_search_results.add_child(_muted("Searching"))
	_api(HTTPClient.METHOD_GET, "/api/players/search", {"q": q}, _on_search)

func _on_search(code: int, json: Variant) -> void:
	_clear_search_results()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_search_results.add_child(_muted("Search failed - try again."))
		return
	var found: Array = json.get("players", [])
	if found.is_empty():
		_search_results.add_child(_muted("No players found."))
		return
	for p in found:
		_search_results.add_child(_search_row(p))

func _search_row(p: Dictionary) -> Control:
	var shell := _row_shell()
	var row := row_body(shell)
	var online: bool = bool(p.get("online", false))
	row.add_child(_dot(COLOR_ONLINE if online else COLOR_OFFLINE))
	row.add_child(_row_name(String(p.get("name", "")), Color(0.956863, 0.890196, 0.760784)))
	var uid := String(p.get("userId", ""))
	var add := Button.new()
	add.theme_type_variation = &"SmallButton"
	add.text = "Add"
	add.pressed.connect(func():
		add.disabled = true
		add.text = "Sending"
		_api(HTTPClient.METHOD_POST, "/api/friends/request", {"userId": uid}, func(code, json):
			var ok: bool = code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false)
			add.text = "Sent" if ok else "Failed"
			if ok:
				refresh()
			else:
				add.disabled = false
		)
	)
	row.add_child(add)
	return shell

func _muted(text: String) -> Label:
	var l := Label.new()
	l.theme_type_variation = &"InfoText"
	l.text = text
	return l

func _on_join(friend_user_id: String) -> void:
	_joining = true
	_status_label.text = "Joining your friend"
	NetworkManager.send_join_friend(friend_user_id)

func _on_lobby_joined(lobby: Dictionary) -> void:
	if not _open or not _joining:
		return
	close()
	var lobby_name := String(lobby.get("name", "lobby"))
	Loader.change_scene("res://scenes/open_world.tscn", "Joining " + lobby_name)

func _on_lobby_denied(reason: String) -> void:
	if not _open or not _joining:
		return
	_joining = false
	_status_label.text = reason

func _api(method: int, path: String, params: Dictionary, cb: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path + "?token=" + NetworkManager.session_token.uri_encode()
	var body := ""
	if method == HTTPClient.METHOD_GET:
		for k in params:
			url += "&%s=%s" % [k, String(params[k]).uri_encode()]
	else:
		body = JSON.stringify(params)
	req.request_completed.connect(func(_result, code, _headers, data):
		var json = null
		if data.size() > 0:
			json = JSON.parse_string(data.get_string_from_utf8())
		cb.call(code, json)
		req.queue_free()
	)
	req.request(url, PackedStringArray(["Content-Type: application/json"]), method, body)
