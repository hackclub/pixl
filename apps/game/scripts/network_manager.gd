extends Node
signal logged_in(display_name: String)
signal connected_to_server
signal disconnected_from_server
signal player_joined(user_id: String, display_name: String, pos: Vector2, direction: String, skin: String)
signal player_moved(user_id: String, pos: Vector2, direction: String)
signal player_left(user_id: String)
signal scene_init(your_user_id: String, your_pos: Vector2, other_players: Array, spawn_at_default: bool)
signal player_skin_changed(user_id: String, skin: String)
signal chat_message(user_id: String, display_name: String, text: String)
signal dm_received(from_name: String, to_name: String, text: String, outgoing: bool)
signal dm_error(reason: String)
signal emote_received(user_id: String, key: String)
signal blocks_updated(ids: Array)
signal npc_init(scene: String, npcs: Array)
signal lobby_list_received(lobbies: Array)
signal lobby_joined(lobby: Dictionary)
signal lobby_denied(reason: String)
signal village_invited(invite_id: int, from_name: String, lobby_name: String)
signal lobby_theme_changed(theme: String)
signal name_result(ok: bool, text: String)

const DEV_SERVER_URL = "http://localhost:4728"
const DEV_WS_URL = "ws://localhost:4728/ws"

const USE_PROD: bool = true

# The prod hosts live in packages/config/pixl.json and reach the export through
# res://pixl.json, so moving domains is one config edit plus `bun run
# config:sync` rather than a hunt through the scripts. These are vars, not
# consts, because a const has to be known at parse time and this reads the
# synced file at runtime.
var SERVER_HTTP_URL: String = PixlConfig.url("server", "https://server.pixl.hackclub.com") if USE_PROD else DEV_SERVER_URL
var SERVER_WS_URL: String = PixlConfig.url("ws", "wss://server.pixl.hackclub.com/ws") if USE_PROD else DEV_WS_URL

var session_token: String = ""
var user_id: String = ""
var display_name: String = ""
var _blocked: Dictionary = {}
var is_new_account: bool = false
var ban_message: String = ""
var local_skin: String = "cvc:1"
var current_scene_name: String = "village"
var current_lobby_id: String = ""
var current_lobby_theme: String = ""
var _socket: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false
const TOKEN_SAVE_PATH = "user://session.dat"
const LOCAL_CALLBACK_PORT = 7777
var _tcp_server: TCPServer = TCPServer.new()
var _listening: bool = false
var _http: HTTPRequest
var _pending_scene_change: String = ""
var _connect_deadline_msec: int = 0
const CONNECT_TIMEOUT_MSEC := 8000

func _is_socket_open() -> bool:
	return _socket.get_ready_state() == WebSocketPeer.STATE_OPEN

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

	_http = HTTPRequest.new()
	add_child(_http)

	if OS.has_feature("web"):
		_check_web_login_callback()

	_try_auto_login()

func _try_auto_login() -> void:
	var saved = _load_session()
	if saved.has("token") and saved["token"] != "":
		session_token = saved["token"]
		display_name = saved.get("display_name", "")
		_connect_to_server()
		emit_signal("logged_in", display_name)

func _save_session() -> void:
	var file = FileAccess.open(TOKEN_SAVE_PATH, FileAccess.WRITE)
	if file:
		var data = { "token": session_token, "display_name": display_name }
		file.store_string(JSON.stringify(data))
		file.close()

func _load_session() -> Dictionary:
	if not FileAccess.file_exists(TOKEN_SAVE_PATH):
		return {}
	var file = FileAccess.open(TOKEN_SAVE_PATH, FileAccess.READ)
	if not file:
		return {}
	var content = file.get_as_text()
	file.close()
	var parsed = JSON.parse_string(content)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed

func clear_session() -> void:
	session_token = ""
	display_name = ""
	user_id = ""
	if FileAccess.file_exists(TOKEN_SAVE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(TOKEN_SAVE_PATH))
	# The dashboard and the rest of the web pages hold their own copy of the
	# token, so drop that one too rather than leaving them signed in.
	WebPages.sign_out()

func _process(_delta: float) -> void:
	if _listening:
		_process_login_listener()
	if not _connected:
		return
	_socket.poll()
	var state = _socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		_connect_deadline_msec = 0
		if _pending_scene_change != "":
			var sc := _pending_scene_change
			_pending_scene_change = ""
			_socket.send_text(JSON.stringify({ "type": "change_scene", "scene": sc }))
		while _socket.get_available_packet_count() > 0:
			var pkt := _socket.get_packet()
			if _socket.was_string_packet():
				_handle_message(pkt.get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CONNECTING:
		# The handshake can hang indefinitely (never reaching OPEN or CLOSED)
		# on a flaky connection - without this, request_lobby_list() and
		# everything else keeps silently no-opping forever with no feedback.
		if _connect_deadline_msec != 0 and Time.get_ticks_msec() > _connect_deadline_msec:
			push_error("WebSocket handshake timed out, retrying")
			_connect_to_server()
	elif state == WebSocketPeer.STATE_CLOSED:
		var was_connected := _connected
		_connected = false
		if was_connected:
			var code = _socket.get_close_code()
			if code == 4001:
				clear_session()
			elif code == 4003:
				ban_message = _socket.get_close_reason()
				if ban_message == "":
					ban_message = "You are banned from Pixl."
				get_tree().change_scene_to_file("res://scenes/login.tscn")
		emit_signal("disconnected_from_server")

func start_login() -> void:
	if OS.has_feature("web"):
		_start_login_web()
	else:
		_start_login_desktop()

func _start_login_desktop() -> void:
	var err = _tcp_server.listen(LOCAL_CALLBACK_PORT, "127.0.0.1")
	if err != OK:
		push_error("Could not start local login listener: %s" % err)
		return
	_listening = true
	OS.shell_open(SERVER_HTTP_URL + "/auth/hackclub")

func _start_login_web() -> void:
	var current_url = JavaScriptBridge.eval(
		"window.location.origin + window.location.pathname", true
	)
	var redirect_target = SERVER_HTTP_URL + "/auth/hackclub?web_redirect=" + String(current_url).uri_encode()
	JavaScriptBridge.eval("window.location.href = '%s';" % redirect_target, true)

func _check_web_login_callback() -> void:
	var query = JavaScriptBridge.eval("window.location.search", true)
	if query == null or String(query) == "":
		return
	var query_str: String = String(query).lstrip("?")
	var token = _extract_query_param_from_string(query_str, "token")
	var name = _extract_query_param_from_string(query_str, "name")
	if token != "":
		session_token = token
		display_name = name
		is_new_account = _extract_query_param_from_string(query_str, "new") == "1"
		_save_session()
		emit_signal("logged_in", display_name)
		_connect_to_server()
		JavaScriptBridge.eval(
			"window.history.replaceState({}, document.title, window.location.pathname);", true
		)
func _process_login_listener() -> void:
	if not _tcp_server.is_connection_available():
		return
	var conn: StreamPeerTCP = _tcp_server.take_connection()
	await get_tree().create_timer(0.05).timeout
	conn.poll()
	var available = conn.get_available_bytes()
	if available <= 0:
		return
	var request = conn.get_utf8_string(available)
	var token = _extract_query_param(request, "token")
	var name = _extract_query_param(request, "name")
	var body = "<html><body style='font-family:sans-serif;text-align:center;margin-top:4rem;'><h2>Logged in! You can close this tab.</h2></body></html>"
	var response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" % [body.length(), body]
	conn.put_data(response.to_utf8_buffer())
	conn.disconnect_from_host()
	_tcp_server.stop()
	_listening = false
	if token != "":
		session_token = token
		display_name = name
		is_new_account = _extract_query_param(request, "new") == "1"
		_save_session()
		emit_signal("logged_in", display_name)
		_connect_to_server()
	else:
		push_error("Login callback did not contain a token")

func _extract_query_param(http_request: String, key: String) -> String:
	var first_line = http_request.split("\r\n")[0]
	var parts = first_line.split(" ")
	if parts.size() < 2:
		return ""
	var path_and_query = parts[1]
	var query_index = path_and_query.find("?")
	if query_index == -1:
		return ""
	var query = path_and_query.substr(query_index + 1)
	return _extract_query_param_from_string(query, key)

func _extract_query_param_from_string(query: String, key: String) -> String:
	for pair in query.split("&"):
		var kv = pair.split("=")
		if kv.size() == 2 and kv[0] == key:
			return kv[1].uri_decode()
	return ""

# --- CONNECTION ---
func _connect_to_server() -> void:
	var state = _socket.get_ready_state()
	if state != WebSocketPeer.STATE_CLOSED:
		_socket.close()
		_connected = false

	var url = SERVER_WS_URL + "?token=" + session_token
	var err = _socket.connect_to_url(url)
	if err != OK:
		push_error("WebSocket connection failed: %s" % err)
		return
	_connected = true
	_connect_deadline_msec = Time.get_ticks_msec() + CONNECT_TIMEOUT_MSEC

func _handle_message(raw: String) -> void:
	var json = JSON.parse_string(raw)
	if json == null:
		return
	match json.get("type"):
		"init":
			var room := String(json.get("scene", ""))
			if room.begins_with("lobby:"):
				current_lobby_id = room.substr(6)
			elif room != "":
				current_lobby_id = ""
			user_id = json["you"]["userId"]
			display_name = json["you"]["displayName"]
			local_skin = String(json["you"].get("skin", local_skin))
			var my_pos = Vector2(json["you"]["posX"], json["you"]["posY"])

			var spawn_at_default = json.get("spawnAtDefault", false)
			emit_signal("scene_init", user_id, my_pos, json.get("players", []), spawn_at_default)
			emit_signal("connected_to_server")
		"player_joined":
			emit_signal(
				"player_joined",
				json["userId"],
				json["displayName"],
				Vector2(json["posX"], json["posY"]),
				json.get("direction", "bottom"),
				String(json.get("skin", "cvc:1"))
			)
		"player_moved":
			emit_signal(
				"player_moved",
				json["userId"],
				Vector2(json["posX"], json["posY"]),
				json.get("direction", "bottom")
			)
		"player_left":
			emit_signal("player_left", json["userId"])
		"player_skin":
			var uid = json["userId"]
			var sk = String(json.get("skin", "cvc:1"))
			if uid == user_id:
				local_skin = sk
			emit_signal("player_skin_changed", uid, sk)
		"chat":
			emit_signal("chat_message", json["userId"], String(json.get("displayName", "")), String(json.get("text", "")))
		"dm":
			emit_signal(
				"dm_received",
				String(json.get("fromName", "")),
				String(json.get("toName", "")),
				String(json.get("text", "")),
				String(json.get("fromId", "")) == user_id
			)
		"dm_error":
			emit_signal("dm_error", String(json.get("reason", "")))
		"emote":
			emit_signal("emote_received", json["userId"], String(json.get("key", "")))
		"blocks":
			_set_blocks(json.get("ids", []))
		"npc_init":
			var npcs: Array = []
			for n in json.get("npcs", []):
				npcs.append({
					"id": String(n.get("id", "")),
					"pos": Vector2(n.get("posX", 0), n.get("posY", 0))
				})
			emit_signal("npc_init", String(json.get("scene", "")), npcs)
		"lobby_list":
			emit_signal("lobby_list_received", json.get("lobbies", []))
		"lobby_joined":
			var lobby: Dictionary = json.get("lobby", {})
			current_lobby_id = String(lobby.get("id", ""))
			current_lobby_theme = String(lobby.get("theme", ""))
			emit_signal("lobby_joined", lobby)
		"lobby_denied":
			emit_signal("lobby_denied", String(json.get("reason", "")))
		"lobby_theme":
			current_lobby_theme = String(json.get("theme", ""))
			emit_signal("lobby_theme_changed", current_lobby_theme)
		"village_invited":
			emit_signal("village_invited", int(json.get("inviteId", 0)), String(json.get("fromName", "")), String(json.get("lobbyName", "")))
		"lobby_closed":
			current_lobby_id = ""
			current_lobby_theme = ""
			var cs = get_tree().current_scene
			if cs and cs.scene_file_path == "res://scenes/open_world.tscn":
				Loader.change_scene("res://scenes/village.tscn", "Lobby closed, heading home")

func send_emote(key: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "emote", "key": key}))

func send_save_npcs(scene_name: String, npcs: Array) -> void:
	if not _is_socket_open() or npcs.is_empty():
		return
	_socket.send_text(JSON.stringify({"type": "save_npcs", "scene": scene_name, "npcs": npcs}))

func send_move(pos: Vector2, direction: String) -> void:
	if not _is_socket_open():
		return
	var msg = {
		"type": "move",
		"posX": pos.x,
		"posY": pos.y,
		"direction": direction
	}
	_socket.send_text(JSON.stringify(msg))

func send_set_skin(skin: String) -> void:
	local_skin = skin
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({
		"type": "set_skin",
		"skin": skin
	}))
	
func submit_display_name(name: String) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
			display_name = String(json["name"])
			if json.has("token"):
				session_token = String(json["token"])
			is_new_account = false
			_save_session()
			emit_signal("logged_in", display_name)
			emit_signal("name_result", true, display_name)
		else:
			var reason := "Couldn't save that name - try again."
			if typeof(json) == TYPE_DICTIONARY and json.has("reason"):
				reason = String(json["reason"])
			emit_signal("name_result", false, reason)
	)
	var url := SERVER_HTTP_URL + "/api/profile/name?token=" + session_token.uri_encode()
	req.request(url, PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_POST, JSON.stringify({"name": name}))

# The socket can close mid-session (a network blip, or the server's 30s
# heartbeat terminating us while a browser tab is throttled) and nothing in a
# gameplay scene reconnects on its own, so every send_* below quietly no-ops
# until the player reloads. Sends the player can *see* fail report it instead.
# Returns true once a fresh connection is being opened.
func reconnect_if_dropped() -> bool:
	if _is_socket_open() or session_token == "":
		return false
	# Rejoin the room the player is standing in rather than whatever scene the
	# server last persisted; this is the same queue change_scene() uses.
	_pending_scene_change = current_scene_name
	_connect_to_server()
	return true

func send_chat(text: String) -> bool:
	if not _is_socket_open():
		reconnect_if_dropped()
		return false
	_socket.send_text(JSON.stringify({"type": "chat", "text": text}))
	return true

func send_dm(to_name: String, text: String) -> bool:
	if not _is_socket_open():
		reconnect_if_dropped()
		return false
	_socket.send_text(JSON.stringify({"type": "dm", "to": to_name, "text": text}))
	return true

func send_block(target_id: String) -> void:
	if not _is_socket_open() or target_id == "" or target_id == user_id:
		return
	_socket.send_text(JSON.stringify({"type": "block", "userId": target_id}))

func send_unblock(target_id: String) -> void:
	if not _is_socket_open() or target_id == "":
		return
	_socket.send_text(JSON.stringify({"type": "unblock", "userId": target_id}))

func is_blocked(target_id: String) -> bool:
	return _blocked.has(target_id)

func _set_blocks(ids: Array) -> void:
	_blocked.clear()
	for id in ids:
		_blocked[String(id)] = true
	emit_signal("blocks_updated", ids)

func send_join_friend(friend_user_id: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_join_friend", "userId": friend_user_id}))

func send_accept_village_invite(invite_id: int) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_accept_invite", "inviteId": invite_id}))

func send_scene_change(scene_name: String) -> void:
	var actual := scene_name
	if scene_name == "open_world" and current_lobby_id != "":
		actual = "lobby:" + current_lobby_id
	elif scene_name != "open_world":
		current_lobby_id = ""
		current_lobby_theme = ""
	current_scene_name = actual
	if _is_socket_open():
		_socket.send_text(JSON.stringify({ "type": "change_scene", "scene": actual }))
	else:
		_pending_scene_change = actual

func request_lobby_list() -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_list"}))

func send_lobby_create(is_public: bool, lobby_name: String = "") -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_create", "isPublic": is_public, "name": lobby_name}))

func send_lobby_join(id: String, password: String = "") -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_join", "id": id, "password": password}))

func send_lobby_quick_join() -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_quick_join"}))

func send_lobby_rename(id: String, new_name: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_manage", "id": id, "action": "rename", "name": new_name}))

func send_lobby_visibility(id: String, is_public: bool) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_manage", "id": id, "action": "visibility", "isPublic": is_public}))

func send_lobby_delete(id: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_manage", "id": id, "action": "delete"}))

func send_lobby_theme(id: String, theme: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_manage", "id": id, "action": "theme", "theme": theme}))

func send_buy_village_theme(id: String, theme: String) -> void:
	if not _is_socket_open():
		return
	_socket.send_text(JSON.stringify({"type": "lobby_manage", "id": id, "action": "buy_theme", "theme": theme}))

func is_connected_to_server() -> bool:
	return _connected

func logout() -> void:
	if _socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_socket.close()
	_connected = false
	clear_session()
