extends Control

# Main menu & pause menu keep the original Monocraft face; the rest of the game
# moved its default menu font to Pixelify Sans (see commit b8b1360). This menu
# is reached straight from the main menu, so it keeps Monocraft too.
const OLD_MENU_FONT := preload("res://assets/fonts/Monocraft.ttf")

const COLOR_PUBLIC := Color(0.290196, 0.870588, 0.501961)
const COLOR_PRIVATE := Color(1, 0.819608, 0.4)

# Village theme upgrades. Ids/prices mirror VILLAGE_THEMES on the server; the
# world tints for these live in multiplayer_world.gd. "" is the free default.
const THEME_CATALOG := [
	{"id": "", "name": "Default", "price": 0},
	{"id": "autumn", "name": "Autumn", "price": 400},
	{"id": "blossom", "name": "Blossom", "price": 400},
	{"id": "verdant", "name": "Verdant", "price": 400},
	{"id": "dusk", "name": "Dusk", "price": 600},
]

@onready var status_label: Label = %StatusLabel
@onready var quick_join_button: Button = %QuickJoinButton
@onready var refresh_button: Button = %RefreshButton
@onready var name_edit: LineEdit = %NameEdit
@onready var create_public_button: Button = %CreatePublicButton
@onready var create_private_button: Button = %CreatePrivateButton
@onready var code_edit: LineEdit = %CodeEdit
@onready var password_edit: LineEdit = %PasswordEdit
@onready var join_code_button: Button = %JoinCodeButton
@onready var list_box: VBoxContainer = %ListBox
@onready var back_button: Button = %BackButton

var _joining := false
var _theme_open_id := ""
var _last_lobbies: Array = []

func _ready() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
		return

	# Duplicate first so we don't mutate the shared theme resource other menus use.
	theme = theme.duplicate(true)
	theme.default_font = OLD_MENU_FONT

	quick_join_button.pressed.connect(_on_quick_join)
	refresh_button.pressed.connect(_refresh)
	create_public_button.pressed.connect(_on_create.bind(true))
	create_private_button.pressed.connect(_on_create.bind(false))
	join_code_button.pressed.connect(_on_join_code)
	back_button.pressed.connect(_on_back)

	NetworkManager.lobby_list_received.connect(_on_list)
	NetworkManager.lobby_joined.connect(_on_joined)
	NetworkManager.lobby_denied.connect(_on_denied)
	NetworkManager.disconnected_from_server.connect(_on_disconnected)

	var timer := Timer.new()
	timer.wait_time = 5.0
	timer.autostart = true
	timer.timeout.connect(_refresh)
	add_child(timer)

	quick_join_button.grab_focus()
	status_label.text = "Fetching lobbies"
	_refresh()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		_on_back()

func _refresh() -> void:
	NetworkManager.request_lobby_list()

func _on_quick_join() -> void:
	status_label.text = "Finding you a lobby"
	NetworkManager.send_lobby_quick_join()

func _on_create(is_public: bool) -> void:
	status_label.text = "Creating lobby"
	NetworkManager.send_lobby_create(is_public, name_edit.text.strip_edges())

func _on_join_code() -> void:
	var code := code_edit.text.strip_edges().to_upper()
	if code == "":
		status_label.text = "Enter a lobby code first."
		return
	status_label.text = "Joining " + code
	NetworkManager.send_lobby_join(code, password_edit.text.strip_edges())

func _on_joined(lobby: Dictionary) -> void:
	if _joining:
		return
	_joining = true
	var lobby_name := String(lobby.get("name", "lobby"))
	Loader.change_scene("res://scenes/open_world.tscn", "Joining " + lobby_name)

func _on_denied(reason: String) -> void:
	status_label.text = reason

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
	else:
		status_label.text = "Disconnected from server."

func _on_list(lobbies: Array) -> void:
	_last_lobbies = lobbies
	for child in list_box.get_children():
		child.queue_free()
	if status_label.text == "Fetching lobbies":
		status_label.text = ""
	if lobbies.is_empty():
		var empty := Label.new()
		empty.theme_type_variation = &"InfoText"
		empty.text = "No lobbies yet - create one!"
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		list_box.add_child(empty)
		return
	for lobby in lobbies:
		if typeof(lobby) == TYPE_DICTIONARY:
			list_box.add_child(_build_row(lobby))

func _build_row(lobby: Dictionary) -> Control:
	var id := String(lobby.get("id", ""))
	var is_public := bool(lobby.get("isPublic", true))
	var mine := bool(lobby.get("mine", false))
	var count := int(lobby.get("count", 0))
	var capacity := int(lobby.get("capacity", 16))
	var full := count >= capacity

	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"

	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 6)
	panel.add_child(outer)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	outer.add_child(row)

	var dot := ColorRect.new()
	dot.color = COLOR_PUBLIC if is_public else COLOR_PRIVATE
	dot.custom_minimum_size = Vector2(10, 10)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(dot)

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 2)
	row.add_child(main)

	var name_label := Label.new()
	name_label.text = String(lobby.get("name", id))
	name_label.clip_text = true
	main.add_child(name_label)

	var meta := Label.new()
	meta.theme_type_variation = &"InfoText"
	var bits: Array[String] = ["%d/%d" % [count, capacity], "code %s" % id]
	if not is_public:
		bits.append("private")
	if mine:
		bits.append("yours")
		if not is_public and lobby.has("password"):
			bits.append("pass %s" % String(lobby["password"]))
	meta.text = " · ".join(bits)
	meta.clip_text = true
	main.add_child(meta)

	if mine:
		var rename := Button.new()
		rename.theme_type_variation = &"StepButton"
		rename.text = "Rename"
		rename.pressed.connect(_on_row_rename.bind(id))
		row.add_child(rename)

		var vis := Button.new()
		vis.theme_type_variation = &"StepButton"
		vis.text = "Make Private" if is_public else "Make Public"
		vis.pressed.connect(_on_row_visibility.bind(id, not is_public))
		row.add_child(vis)

		var del := Button.new()
		del.theme_type_variation = &"StepButton"
		del.text = "Delete"
		del.pressed.connect(_on_row_delete.bind(del, id))
		row.add_child(del)

		var themes := Button.new()
		themes.theme_type_variation = &"StepButton"
		themes.text = "Themes"
		themes.pressed.connect(_toggle_themes.bind(id))
		row.add_child(themes)

	var join := Button.new()
	join.theme_type_variation = &"SmallButton"
	join.text = "Full" if full else "Join"
	join.disabled = full
	join.pressed.connect(_on_row_join.bind(id, is_public, mine))
	row.add_child(join)

	if mine and _theme_open_id == id:
		outer.add_child(_theme_picker(lobby))

	return panel

func _toggle_themes(id: String) -> void:
	_theme_open_id = "" if _theme_open_id == id else id
	_on_list(_last_lobbies)

func _theme_picker(lobby: Dictionary) -> Control:
	var id := String(lobby.get("id", ""))
	var active := String(lobby.get("theme", ""))
	var unlocked: Array = lobby.get("themesUnlocked", [])
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	for entry in THEME_CATALOG:
		var tid := String(entry["id"])
		var owned: bool = tid == "" or unlocked.has(tid)
		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 8)
		var label := Label.new()
		label.theme_type_variation = &"InfoText"
		label.text = String(entry["name"])
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		trow.add_child(label)
		if tid == active:
			var badge := Label.new()
			badge.theme_type_variation = &"InfoText"
			badge.text = "active"
			badge.add_theme_color_override("font_color", COLOR_PUBLIC)
			trow.add_child(badge)
		elif owned:
			var apply := Button.new()
			apply.theme_type_variation = &"StepButton"
			apply.text = "Apply"
			apply.pressed.connect(func(): NetworkManager.send_lobby_theme(id, tid))
			trow.add_child(apply)
		else:
			var buy := Button.new()
			buy.theme_type_variation = &"StepButton"
			buy.text = "Buy %d px" % int(entry["price"])
			buy.pressed.connect(func(): NetworkManager.send_buy_village_theme(id, tid))
			trow.add_child(buy)
		box.add_child(trow)
	return box

func _on_row_join(id: String, is_public: bool, mine: bool) -> void:
	if is_public or mine:
		status_label.text = "Joining " + id
		NetworkManager.send_lobby_join(id)
		return
	var pw := password_edit.text.strip_edges()
	if pw == "":
		code_edit.text = id
		status_label.text = "Private lobby - type its password below, then press Join."
		password_edit.grab_focus()
		return
	status_label.text = "Joining " + id
	NetworkManager.send_lobby_join(id, pw)

func _on_row_rename(id: String) -> void:
	var new_name := name_edit.text.strip_edges()
	if new_name == "":
		status_label.text = "Type the new name in the name box, then press Rename."
		name_edit.grab_focus()
		return
	NetworkManager.send_lobby_rename(id, new_name)
	name_edit.text = ""

func _on_row_visibility(id: String, is_public: bool) -> void:
	NetworkManager.send_lobby_visibility(id, is_public)

func _on_row_delete(btn: Button, id: String) -> void:
	if btn.get_meta("armed", false):
		NetworkManager.send_lobby_delete(id)
		return
	btn.set_meta("armed", true)
	btn.text = "Sure?"
	var revert := get_tree().create_timer(3.0)
	revert.timeout.connect(func():
		if is_instance_valid(btn):
			btn.set_meta("armed", false)
			btn.text = "Delete")

func _on_back() -> void:
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
