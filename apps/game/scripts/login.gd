extends Control

@onready var status_label: Label = $CenterContainer/VBoxContainer/StatusLabel
@onready var login_button: Button = $CenterContainer/VBoxContainer/LoginButton

func _ready() -> void:
	NetworkManager.logged_in.connect(_on_logged_in)
	NetworkManager.connected_to_server.connect(_on_connected)

	login_button.pressed.connect(_on_login_pressed)

	if NetworkManager.ban_message != "":
		status_label.text = NetworkManager.ban_message
		NetworkManager.ban_message = ""
	elif NetworkManager.display_name != "":
		status_label.text = "Logged in as: " + NetworkManager.display_name + " - connecting..."
	else:
		status_label.text = "Not logged in"

func _on_login_pressed() -> void:
	status_label.text = "Opening browser..."
	login_button.disabled = true
	NetworkManager.start_login()

func _on_logged_in(name: String) -> void:
	status_label.text = "Logged in as: " + name

func _on_connected() -> void:
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
	
