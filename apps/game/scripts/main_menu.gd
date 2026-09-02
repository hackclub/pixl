extends Control

@onready var status_label: Label = $CenterContainer/VBoxContainer/StatusLabel
@onready var play_button: Button = $CenterContainer/VBoxContainer/PlayButton
@onready var lobbies_button: Button = $CenterContainer/VBoxContainer/LobbiesButton
@onready var friends_button: Button = $CenterContainer/VBoxContainer/FriendsButton
@onready var inbox_button: Button = $CenterContainer/VBoxContainer/InboxButton
@onready var character_button: Button = $CenterContainer/VBoxContainer/CharacterButton
@onready var settings_button: Button = $CenterContainer/VBoxContainer/SettingsButton
@onready var logout_button: Button = $CenterContainer/VBoxContainer/LogoutButton

# Main menu & pause menu keep the original Monocraft face; the rest of the game
# moved its default menu font to Pixelify Sans (see commit b8b1360).
const OLD_MENU_FONT := preload("res://assets/fonts/Monocraft.ttf")

var _logout_armed := false
var _logout_revert: Timer

func _ready() -> void:
	# Swap the shared theme's default font back to Monocraft for this scene only
	# (duplicate first so we don't mutate the resource other menus share).
	theme = theme.duplicate(true)
	theme.default_font = OLD_MENU_FONT
	# Menu is laid out for a 1600x900 desktop canvas, on touch devices, bump
	# the theme's font sizes and the explicit control sizes below instead of
	# Control.scale (a transform just blurs the already-rasterized pixel
	# font instead of actually growing it).
	if DisplayServer.is_touchscreen_available():
		var factor := Settings.menu_scale_factor()
		theme = Settings.touch_menu_theme(theme)
		var vbox: VBoxContainer = $CenterContainer/VBoxContainer
		vbox.custom_minimum_size *= factor
		var logo: Control = $CenterContainer/VBoxContainer/TitleLogo
		logo.custom_minimum_size *= factor
		var footer: Control = $Footer
		footer.offset_left *= factor
		footer.offset_right *= factor
		footer.offset_top *= factor
		footer.offset_bottom *= factor
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
		return

	status_label.text = "Signed in as " + NetworkManager.display_name

	play_button.pressed.connect(_on_play_pressed)
	lobbies_button.pressed.connect(_on_lobbies_pressed)
	friends_button.pressed.connect(_on_friends_pressed)
	inbox_button.pressed.connect(_on_inbox_pressed)
	_update_inbox_button(InboxHud.unread_count)
	InboxHud.unread_changed.connect(_update_inbox_button)
	character_button.pressed.connect(_on_character_pressed)
	settings_button.pressed.connect(_on_settings_pressed)
	logout_button.pressed.connect(_on_logout_pressed)

	_logout_revert = Timer.new()
	_logout_revert.one_shot = true
	_logout_revert.wait_time = 3.0
	_logout_revert.timeout.connect(_disarm_logout)
	add_child(_logout_revert)

	play_button.grab_focus()

	NetworkManager.disconnected_from_server.connect(_on_disconnected)

func _on_play_pressed() -> void:
	Loader.change_scene("res://scenes/village.tscn", "Entering village")

func _on_lobbies_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")

func _on_friends_pressed() -> void:
	FriendsHud.open()

func _on_inbox_pressed() -> void:
	InboxHud.open()

func _update_inbox_button(unread: int) -> void:
	inbox_button.text = "Inbox (%d)" % unread if unread > 0 else "Inbox"

func _on_character_pressed() -> void:
	global.editor_return_scene = "res://scenes/main_menu.tscn"
	get_tree().change_scene_to_file("res://scenes/character_editor.tscn")

func _on_settings_pressed() -> void:
	PauseMenu.open_settings()

func _on_logout_pressed() -> void:
	if not _logout_armed:
		_logout_armed = true
		logout_button.text = "Confirm logout?"
		_logout_revert.start()
		return
	_logout_revert.stop()
	NetworkManager.logout()
	get_tree().change_scene_to_file("res://scenes/login.tscn")

func _disarm_logout() -> void:
	_logout_armed = false
	logout_button.text = "Logout"

	play_button.grab_focus()

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
