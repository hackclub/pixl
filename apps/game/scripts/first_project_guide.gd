extends CanvasLayer
## First-Trial checklist, a persistent, NON-blocking tracker that walks every new
## Builder through their first Trial, one step at a time: meet the Trial-giver
## (Ridit, out in the frontier) → create the project → set up Hackatime → build it
## → ship it.
##
## onboarding.gd calls begin() for everyone at the end of arrival. From then on the
## tracker lives across scenes and sessions, follows real progress by polling the
## server (projects + Hackatime + sidequests), checks steps off as they land, and
## pops a short Pixo line at each milestone. It never pushes a UI blocker, the
## player can walk, chat and tab out to the browser the whole time.

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const SAVE_PATH := "user://first_project_guide.cfg"
const POLL_INTERVAL := 6.0
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)
const DIM := Color(0.62, 0.57, 0.47)
const PIXO := "Pixo"

# The four steps, in order. Each carries its checklist label, the button copy for
# when it's the current step, the companion page that button opens, and the line
# Pixo says once it's completed.
enum { S_MEET, S_CREATE, S_HACKATIME, S_CODE, S_SHIP, S_DONE }
const STEP_LABELS := [
	"Find Ridit in the frontier",
	"Create your project",
	"Set up Hackatime",
	"Build it",
	"Ship it for the Trial",
]
const STEP_ACTIONS := [
	"Open the Lobbies",
	"Open Builder Terminal",
	"Hackatime setup",
	"Open the build guide",
	"Ship it for review",
]
# Where each step's action button goes. S_MEET is special-cased (it changes scene
# to the lobby browser, not a web page) so its entry is unused. The Create step
# hands off to the Builder Terminal with ?onboard=first-project, which kicks off
# the dedicated project-creation walkthrough on the dash (see pixl.js maybeOnboard).
const STEP_PAGES := ["", "projects?onboard=first-project", "docs/hackatime", "docs/first-site", "projects"]
const STEP_HINT := [
	"Head through the Lobbies to the frontier and talk to Ridit, take his Trial, or just start your own project.",
	"Name your project in the Builder Terminal, that tells the Core you're building.",
	"Install Hackatime in your editor and connect it, so the hours you code actually count.",
	"Make the thing. Keep it small and real, the guide has copy-pasteable code to start from.",
	"Once it runs and you've logged some time, ship it for review, flag it for your Trial as you do.",
]
const STEP_DONE_LINE := [
	"You've got a Trial. Now make it real, start by creating your project.",
	"Project created. The Core can see it now. Next: get Hackatime tracking your hours so they count.",
	"Hackatime's live. Every minute you code from here on counts. Go make the thing.",
	"There it is, your first tracked time. Keep going until it's real, then ship it.",
	"You shipped it. Your first Trial is in the Restoration, that's the whole game. Welcome, Builder.",
]

var _active := false
var _step := S_CREATE
var _collapsed := false
var _busy := false
var _busy_at := 0.0
var _last_scene := ""
var _said_open := false  # a milestone Pixo line of ours is currently open

var _root: Control
var _body: VBoxContainer
var _rows: Array = []          # Array[Label]
var _hint: Label
var _action_btn: Button
var _collapse_btn: Button
var _skip_btn: Button
var _skip_armed := false
var _timer: Timer

func _ready() -> void:
	layer = 106
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_timer = Timer.new()
	_timer.wait_time = POLL_INTERVAL
	_timer.timeout.connect(_on_tick)
	add_child(_timer)
	_load_state()
	if _active:
		_render()
		_timer.start()
		_poll()

# ── public ───────────────────────────────────────────────────────────────────

## Start (or restart) the guide, called from the beginner onboarding opt-in.
func begin() -> void:
	_active = true
	_step = S_MEET
	_collapsed = false
	_save_state(true)
	_render()
	_timer.start()
	_poll()

# ── lifecycle / visibility ───────────────────────────────────────────────────

func _process(_delta: float) -> void:
	if not _active:
		if _root.visible:
			_root.visible = false
		return
	_root.visible = _in_gameplay() and NetworkManager.session_token != ""
	# Re-render the "meet" step when the player crosses between the Hub and the
	# frontier, so its hint/button match where they actually are.
	var scene := _current_scene_name()
	if scene != _last_scene:
		_last_scene = scene
		# Left the world (quit to menu / logout), clear any milestone line of ours
		# so it doesn't linger over the main menu or login.
		if not _in_gameplay() and _said_open and Dialogue.is_open:
			Dialogue.close()
			_said_open = false
		if _step == S_MEET:
			_render()

func _current_scene_name() -> String:
	var cur := get_tree().current_scene
	return cur.scene_file_path.get_file().get_basename() if cur else ""

func _in_gameplay() -> bool:
	return GAMEPLAY_SCENES.has(_current_scene_name())

func _on_tick() -> void:
	if _active and _in_gameplay() and NetworkManager.session_token != "":
		_poll()

# Poll the instant the game regains focus. Browsers pause timers in a backgrounded
# tab, so when the player tabs back from creating their project / connecting
# Hackatime in the browser, this catches it right away instead of on the next tick.
func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_IN or what == NOTIFICATION_WM_WINDOW_FOCUS_IN:
		if _active and _in_gameplay() and NetworkManager.session_token != "":
			_poll()

# ── polling / state machine ──────────────────────────────────────────────────

func _poll() -> void:
	if not _active or NetworkManager.session_token == "":
		return
	# A poll is in flight - skip, unless it's been stuck too long (safety net so a
	# wedged request can never permanently stop the checklist from updating).
	if _busy and Time.get_ticks_msec() - _busy_at < 20000:
		return
	_busy = true
	_busy_at = Time.get_ticks_msec()
	var proj: Dictionary = await _api_get("/api/projects")
	var hack: Dictionary = await _api_get("/api/hackatime/stats")
	var quests: Dictionary = await _api_get("/api/sidequests")
	_busy = false
	if not _active:
		return

	var projects: Array = proj.get("projects", []) if typeof(proj.get("projects")) == TYPE_ARRAY else []
	var stats: Dictionary = hack.get("stats", {}) if typeof(hack.get("stats")) == TYPE_DICTIONARY else {}
	var has_project := projects.size() > 0
	var connected := bool(stats.get("connected", false))
	var total_seconds := float(stats.get("totalSeconds", 0))
	var shipped := false
	for p in projects:
		var st := String(p.get("status", ""))
		if st == "shipped" or st == "fraud_review" or st == "second_review" or st == "approved":
			shipped = true
			break
	# The "meet" step clears once a Trial is accepted (unlocked, not yet done),
	# or once they've started a project on their own (going off-map is fine).
	var accepted := false
	var quest_list: Array = quests.get("quests", []) if typeof(quests.get("quests")) == TYPE_ARRAY else []
	for q in quest_list:
		if typeof(q) == TYPE_DICTIONARY and bool(q.get("unlocked", false)) and not bool(q.get("completed", false)):
			accepted = true
			break

	# Current step = the first one that isn't satisfied yet.
	var new_step := S_DONE
	if not accepted and not has_project:
		new_step = S_MEET
	elif not has_project:
		new_step = S_CREATE
	elif not connected:
		new_step = S_HACKATIME
	elif total_seconds <= 0.0:
		new_step = S_CODE
	elif not shipped:
		new_step = S_SHIP
	_apply_step(new_step)

func _apply_step(new_step: int) -> void:
	if new_step == _step:
		return
	# Announce the most recent completion (index new_step - 1), but only while the
	# player's actually in the world, a poll can advance the step on the main menu
	# / login (e.g. a stale saved step catching up on load), and a Pixo line has no
	# business popping over the menu.
	if new_step > _step and _in_gameplay():
		var completed := new_step - 1
		if completed >= 0 and completed < STEP_DONE_LINE.size():
			_say(STEP_DONE_LINE[completed])
	_step = new_step
	_skip_armed = false
	if _step == S_DONE:
		_timer.stop()
		_save_state(false)  # don't auto-resume next session; stays visible until closed
	else:
		_save_state(true)
	_render()

# ── UI ───────────────────────────────────────────────────────────────────────

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.theme = THEME
	_root.visible = false
	add_child(_root)

	# Pinned to the right edge, the left side is crowded with the wallet/chat/HUD.
	var panel := PanelContainer.new()
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.anchor_top = 0.5
	panel.anchor_bottom = 0.5
	panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	panel.offset_left = -318
	panel.offset_right = -18
	panel.custom_minimum_size = Vector2(300, 0)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 18)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 18)
	margin.add_theme_constant_override("margin_bottom", 16)
	panel.add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	margin.add_child(col)

	# Header: title + collapse toggle.
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	col.add_child(header)

	var title := Label.new()
	title.text = "YOUR FIRST TRIAL"
	title.theme_type_variation = &"TitleText"
	title.add_theme_font_size_override("font_size", 18)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title)

	# Manual re-check, so the player is never stuck waiting on the poll. Drawn
	# as a tiny bitmap rather than a "↻" glyph - Monocraft has no glyph for
	# U+21BB, so the text version rendered as a broken tofu box.
	var refresh_btn := Button.new()
	refresh_btn.theme_type_variation = &"GreyButton"
	refresh_btn.icon = _refresh_icon_texture()
	refresh_btn.expand_icon = false
	refresh_btn.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	refresh_btn.custom_minimum_size = Vector2(40, 34)
	refresh_btn.tooltip_text = "Check progress now"
	refresh_btn.pressed.connect(_poll)
	header.add_child(refresh_btn)

	_collapse_btn = Button.new()
	_collapse_btn.theme_type_variation = &"GreyButton"
	_collapse_btn.add_theme_font_size_override("font_size", 22)
	_collapse_btn.custom_minimum_size = Vector2(40, 34)
	_collapse_btn.tooltip_text = "Collapse or expand this panel"
	_collapse_btn.pressed.connect(_toggle_collapse)
	header.add_child(_collapse_btn)

	# Body: the checklist, current-step hint, and the action button.
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 8)
	col.add_child(_body)

	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 5)
	_body.add_child(list)
	for i in STEP_LABELS.size():
		var row := Label.new()
		row.add_theme_font_size_override("font_size", 16)
		row.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		list.add_child(row)
		_rows.append(row)

	_hint = Label.new()
	_hint.theme_type_variation = &"InfoText"
	_hint.add_theme_font_size_override("font_size", 14)
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.add_child(_hint)

	_action_btn = Button.new()
	_action_btn.add_theme_font_size_override("font_size", 16)
	_action_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_action_btn.pressed.connect(_on_action)
	_body.add_child(_action_btn)

	_skip_btn = Button.new()
	_skip_btn.theme_type_variation = &"GreyButton"
	_skip_btn.add_theme_font_size_override("font_size", 13)
	_skip_btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_skip_btn.tooltip_text = "Dismiss this guide for good"
	_skip_btn.pressed.connect(_on_skip)
	_body.add_child(_skip_btn)

# 12x12 pixel-art reload glyph (an open ring with an arrowhead), baked as an
# ImageTexture at build time instead of relying on a font glyph that may not
# exist in Monocraft/Pixelify Sans.
const REFRESH_ICON_PIXELS: Array[Vector2i] = [
	Vector2i(2,3), Vector2i(2,4), Vector2i(2,5), Vector2i(2,6), Vector2i(2,7), Vector2i(2,8),
	Vector2i(3,2), Vector2i(3,3), Vector2i(3,8), Vector2i(3,9),
	Vector2i(4,2), Vector2i(4,9), Vector2i(5,2), Vector2i(5,9),
	Vector2i(6,2), Vector2i(6,9), Vector2i(7,2), Vector2i(7,9),
	Vector2i(8,2), Vector2i(8,3), Vector2i(8,8), Vector2i(8,9),
	Vector2i(9,3), Vector2i(9,4), Vector2i(9,5), Vector2i(10,4),
]

# Baked at an integer scale rather than letting the Button stretch the 12x12
# source, so the glyph stays crisp instead of going soft at the edges.
const ICON_SCALE := 2

func _refresh_icon_texture() -> ImageTexture:
	var img := Image.create(12 * ICON_SCALE, 12 * ICON_SCALE, false, Image.FORMAT_RGBA8)
	for p in REFRESH_ICON_PIXELS:
		for dy in ICON_SCALE:
			for dx in ICON_SCALE:
				img.set_pixel(p.x * ICON_SCALE + dx, p.y * ICON_SCALE + dy, PixlTheme.color("ink"))
	return ImageTexture.create_from_image(img)

func _render() -> void:
	_collapse_btn.text = "+" if _collapsed else "–"  # + when hidden, en-dash when open
	_body.visible = not _collapsed

	for i in _rows.size():
		var label: Label = _rows[i]
		if i < _step:
			label.text = "[x] " + STEP_LABELS[i]
			label.add_theme_color_override("font_color", ACCENT_GOLD)
		elif i == _step:
			label.text = "[>] " + STEP_LABELS[i]
			label.add_theme_color_override("font_color", Color(1, 1, 1))
		else:
			label.text = "[ ] " + STEP_LABELS[i]
			label.add_theme_color_override("font_color", DIM)

	# Nothing left to skip once it's finished; the action button is "Close" there.
	_skip_btn.visible = _step != S_DONE
	_skip_btn.text = "Really skip? Tap again" if _skip_armed else "Skip this trial"

	if _step == S_DONE:
		_hint.text = "All done. Your first Trial is shipped, every other Trial is the same loop."
		_action_btn.text = "Close"
	else:
		_hint.text = STEP_HINT[_step]
		_action_btn.text = STEP_ACTIONS[_step]
		# The "meet Ridit" step reads differently once you're already out in the
		# frontier, don't tell (or send) someone to the Lobbies they're standing in.
		if _step == S_MEET and _current_scene_name() == "open_world":
			_hint.text = "You're in the frontier. Walk up to Ridit and talk to him to take his Trial. (Or start your own project instead.)"
			_action_btn.text = "Start my own project"

func _toggle_collapse() -> void:
	_collapsed = not _collapsed
	_skip_armed = false
	_render()

## Skipping is one-way, the guide only comes back through the onboarding opt-in,
## so it takes two taps rather than throwing the trial away on a stray click.
func _on_skip() -> void:
	if not _skip_armed:
		_skip_armed = true
		_render()
		return
	_skip_armed = false
	_active = false
	_timer.stop()
	_save_state(false)
	_root.visible = false

func _on_action() -> void:
	if _step == S_DONE:
		_active = false
		_root.visible = false
		return
	# The first step sends the player toward Ridit: from the Hub, open the lobby
	# browser (the route to the frontier); if they're already in the frontier the
	# button is the "start your own project" alternative instead. Every other step
	# opens a companion web page.
	if _step == S_MEET:
		if _current_scene_name() == "open_world":
			WebPages.open("projects")
		else:
			get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")
		return
	WebPages.open(STEP_PAGES[_step])

func _say(line: String) -> void:
	# Non-blocking nudge, Dialogue doesn't freeze movement, and we don't await it.
	if line == "":
		return
	Dialogue.open(PIXO, [line])
	_said_open = true
	Dialogue.closed.connect(func(): _said_open = false, CONNECT_ONE_SHOT)

# ── persistence ──────────────────────────────────────────────────────────────

func _save_state(active: bool) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({ "active": active, "step": _step }))
		f.close()

func _load_state() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		return
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(data) != TYPE_DICTIONARY:
		return
	_active = bool(data.get("active", false))
	_step = int(data.get("step", S_CREATE))

# ── net ──────────────────────────────────────────────────────────────────────

func _api_get(path: String) -> Dictionary:
	if NetworkManager.session_token == "":
		return {}
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path
	url += ("&" if path.contains("?") else "?") + "token=" + NetworkManager.session_token.uri_encode()
	# If request() itself fails, request_completed never fires - bail now so the
	# caller's await can't hang forever (which would wedge _busy and stop polling).
	if req.request(url, PackedStringArray(), HTTPClient.METHOD_GET) != OK:
		req.queue_free()
		return {}
	var r: Array = await req.request_completed
	req.queue_free()
	if int(r[1]) != 200 or (r[3] as PackedByteArray).size() == 0:
		return {}
	var json = JSON.parse_string((r[3] as PackedByteArray).get_string_from_utf8())
	return json if typeof(json) == TYPE_DICTIONARY else {}
