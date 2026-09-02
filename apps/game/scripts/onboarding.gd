extends CanvasLayer
## First-run arrival flow, the Day-0 onboarding (ONBOARDING_REDESIGN.md §2-8).
## Orchestrates, in order:
##   cinematic → Pixo greeting → naming ritual → experience question →
##   the loop patter → point the player out to the frontier (Ridit) and start the
##   FirstProjectGuide checklist.
## Pixo is a dialogue speaker only (no world NPC). Runs as a coroutine driven by
## the extended Dialogue autoload; each beat awaits the player.
##
## Two flags keep it runnable without a live server / browser:
##   mock           - skip real network + web hand-off; record what it would do
##   skip_cinematic - jump straight to the greeting (fast headless tests)

signal finished

const THEME := preload("res://themes/main_theme.tres")
const CINEMATIC := preload("res://scenes/intro_cinematic.tscn")
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)
const PIXO := "Pixo"

# Experience answers → the id stored server-side + Pixo's reply.
const EXPERIENCE_OPTIONS := [
	"I'm just starting out.",
	"I've shipped a few things.",
	"I build all the time.",
]
const EXPERIENCE_IDS := ["beginner", "intermediate", "advanced"]
const EXPERIENCE_REPLY := {
	"beginner": "Perfect. Everyone starts somewhere. I'll walk you through the first one, step by step.",
	"intermediate": "Nice. I'll point you at something with a bit of bite and stay out of your way.",
	"advanced": "Good. Then I'll skip the hand-holding. The Core could use someone like you.",
}

# Config
var mock := false
var skip_cinematic := false
# Recorded outcomes (for tests / mock runs)
var captured_name := ""
var captured_experience := ""
var handoff_path := ""

var _running := false
var _blocked := false
var _name_root: Control
var _name_edit: LineEdit
var _name_warn: Label
var _name_save: Button

signal _name_closed(name: String)

func _ready() -> void:
	layer = 108
	process_mode = Node.PROCESS_MODE_ALWAYS

## Kick off the full arrival sequence. Safe to call once; re-entry is ignored.
func start() -> void:
	if _running:
		return
	_running = true
	global.push_ui_blocker()
	_blocked = true

	if not skip_cinematic:
		await _run_cinematic()
	await _greeting()
	await _naming()
	await _experience()
	await _loop_patter()
	# Everyone runs the same loop now: Pixo points the player out to the frontier
	# to meet a Trial-giver (Ridit), and the FirstProjectGuide checklist takes
	# over from there (meet → create → Hackatime → build → ship).
	await _direct_to_frontier()

	_release_block()
	_running = false
	finished.emit()

# Balance the UI blocker at most once, whether the flow ends naturally or is torn
# down early. `ui_blockers` lives on the `global` autoload and survives scene
# changes, so a missed pop freezes the player everywhere.
func _release_block() -> void:
	if _blocked:
		_blocked = false
		global.pop_ui_blocker()

# If the flow is destroyed mid-run - Quit to Main Menu, logout, or a network
# await that never resolves - release the blocker so the player can still move,
# and close any open dialogue so Pixo's lines can't bleed onto the next scene.
func _exit_tree() -> void:
	_release_block()
	if Dialogue.is_open:
		Dialogue.close()

# ── beats ──────────────────────────────────────────────────────────────────

func _run_cinematic() -> void:
	var cine := CINEMATIC.instantiate()
	add_child(cine)
	cine.play()
	await cine.finished
	cine.queue_free()

func _greeting() -> void:
	await _say([
		"Oh, you actually came. Good. I wasn't sure anyone would.",
		"I'm Pixo. I've kept this little Hub lit since the Static hit. It's the last stable ground we've got.",
		"Everything past the edge is frozen. Saloons stopped mid-song. Trains halted on the rails. Whole districts gone to pixels.",
		"We can bring it back. That's not a hope, it's how this place works. But I can't do it alone, and neither can the Core.",
		"First things first, though. Let's get you sorted.",
	])

func _naming() -> void:
	while true:
		await _say([
			"So, what should everyone call you around here?",
			"Names matter. It's the first thing the world remembers about you.",
		])
		var name: String = await _prompt_name()
		var result: Dictionary = await _submit_name(name)
		if result.get("ok", false):
			captured_name = String(result.get("name", name))
			await _say(["%s. Alright, the Hub knows you now." % captured_name])
			return
		# Rejected, Pixo softens it, then we loop back to ask again.
		await _say([_soften_name_error(String(result.get("reason", "")))])

func _experience() -> void:
	Dialogue.ask(PIXO,
		[
			"One more thing, so I know how much to explain. Be honest: there's no wrong answer.",
			"How much have you built before?",
		],
		PackedStringArray(EXPERIENCE_OPTIONS),
		PackedStringArray(EXPERIENCE_IDS))
	var picked: Array = await Dialogue.chosen
	var id := String(picked[1]) if picked.size() > 1 else "beginner"
	if not EXPERIENCE_IDS.has(id):
		id = "beginner"
	captured_experience = id
	await _post_experience(id)
	await _say([EXPERIENCE_REPLY.get(id, EXPERIENCE_REPLY["beginner"])])

func _loop_patter() -> void:
	await _say([
		"Here's the whole deal. See that dark spire? That's the Core: it used to power all of Origin. Now it's a sealed vault, holding everything we ever made.",
		"You bring it back by building. Real things: a website, a bot, a game, whatever's yours. The jobs are called Trials.",
		"Every hour of real work you ship becomes Restoration Energy. That's what thaws the world and wakes the Core.",
		"And when the Core wakes, it hands back what it's been keeping: real gear, real rewards. That part isn't a metaphor.",
		"Ship enough and you'll feel it: the more you build, the more each hour pays. Pixels for you, energy for all of us.",
	])

# Universal hand-off: the Trials live out in the regions, not the Hub. Point the
# player through the Lobbies to the frontier to meet Ridit, then hand control to
# the FirstProjectGuide checklist. Building your own idea instead is always fine.
func _direct_to_frontier() -> void:
	Dialogue.ask(PIXO,
		[
			"The Trials themselves aren't here in the Hub, they're out past the edge, in the regions.",
			"Head through the Lobbies to reach the frontier, and find Ridit out there. He keeps the Dustline, and he's holding a first Trial for you.",
			"Take his, or build something entirely your own, the Core recognizes both. Either way the loop's the same: build it, ship it, watch the world thaw.",
		],
		PackedStringArray(["Open the Lobbies", "I'll head out myself"]),
		PackedStringArray(["lobbies", "later"]))
	var picked: Array = await Dialogue.chosen
	var choice := String(picked[1]) if picked.size() > 1 else "later"
	await _say(["Oh, one more thing: that opening you just watched was drawn by noct. Genuinely great artist, go hire them if you ever need art done."])
	await _say(["I'll pin a checklist to your screen so you never lose the thread. First stop, find Ridit."])
	# Awaited: start() emits `finished` right after this returns, which frees
	# this node (see village.gd's flow.finished.connect -> queue_free), an
	# un-awaited call here let that teardown cancel the in-flight HTTPRequest
	# before the POST reached the server, so onboarding_step never actually
	# persisted and the whole flow replayed on every single login.
	await _mark_step_done()
	FirstProjectGuide.begin()
	# Send them straight to the lobby browser (the way to the frontier). Deferred
	# by change_scene, so start() still unwinds its UI blocker cleanly first.
	if choice == "lobbies":
		handoff_path = "lobby_menu"
		if not mock:
			get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")

# ── helpers: dialogue ────────────────────────────────────────────────────────

func _say(lines: Array) -> void:
	Dialogue.open(PIXO, lines)
	await Dialogue.closed

# ── helpers: name overlay ────────────────────────────────────────────────────

func _prompt_name() -> String:
	_build_name_overlay()
	var name: String = await _name_closed
	if _name_root:
		_name_root.queue_free()
		_name_root = null
	return name

func _build_name_overlay() -> void:
	_name_root = Control.new()
	_name_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_name_root.theme = THEME
	add_child(_name_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.023529, 0.007843, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_name_root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.offset_top = -120  # sit above the dialogue plate
	_name_root.add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(460, 0)
	center.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_top", 22)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_bottom", 20)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	margin.add_child(body)

	var info := Label.new()
	info.text = "What should everyone call you?"
	info.theme_type_variation = &"TitleText"
	info.add_theme_font_size_override("font_size", 22)
	body.add_child(info)

	_name_edit = LineEdit.new()
	_name_edit.text = NetworkManager.display_name
	_name_edit.placeholder_text = "Your name"
	_name_edit.max_length = 24
	_name_edit.text_submitted.connect(func(_t): _submit_name_overlay())
	body.add_child(_name_edit)

	_name_warn = Label.new()
	_name_warn.add_theme_color_override("font_color", Color(1, 0.42, 0.42))
	_name_warn.add_theme_font_size_override("font_size", 14)
	_name_warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_name_warn.visible = false
	body.add_child(_name_warn)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	body.add_child(buttons)

	var keep := Button.new()
	keep.theme_type_variation = &"GreyButton"
	keep.text = "Keep \"%s\"" % NetworkManager.display_name if NetworkManager.display_name != "" else "Skip"
	keep.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	keep.pressed.connect(func(): _finish_name(NetworkManager.display_name))
	buttons.add_child(keep)

	_name_save = Button.new()
	_name_save.text = "That's me"
	_name_save.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_save.pressed.connect(_submit_name_overlay)
	buttons.add_child(_name_save)

	_name_edit.grab_focus()
	_name_edit.select_all()

func _submit_name_overlay() -> void:
	var name := _name_edit.text.strip_edges()
	if name == "":
		name = NetworkManager.display_name
	_finish_name(name)

# Emit the chosen name once; guard against double-fire from Enter + button.
func _finish_name(name: String) -> void:
	if _name_root == null:
		return
	_name_closed.emit(name)

func _show_name_warn(text: String) -> void:
	# Re-open the overlay with the rejection shown (used on a failed submit).
	if _name_root == null:
		_build_name_overlay()
	_name_warn.text = text
	_name_warn.visible = true
	if _name_edit:
		_name_edit.grab_focus()

func _soften_name_error(reason: String) -> String:
	if reason.to_lower().contains("okay here") or reason.to_lower().contains("friendly"):
		return "Hah, let's keep it friendly, yeah? The little ones look up to us. Try another."
	if reason == "":
		return "Hm, that one won't stick. Try another?"
	return reason

# ── helpers: network (mockable) ──────────────────────────────────────────────

# Returns { ok: bool, name/reason }. Real path goes through NetworkManager so the
# session token is refreshed to match the new name (see submit_display_name).
func _submit_name(name: String) -> Dictionary:
	if mock:
		# Simulate the server's moderation gate so tests can exercise the retry.
		if name.to_lower().contains("badword"):
			return { "ok": false, "reason": "That name isn't okay here." }
		return { "ok": true, "name": name }
	if name == "" or name == NetworkManager.display_name:
		return { "ok": true, "name": NetworkManager.display_name }
	NetworkManager.submit_display_name(name)
	var res: Array = await NetworkManager.name_result
	if res[0]:
		return { "ok": true, "name": String(res[1]) }
	return { "ok": false, "reason": String(res[1]) }

func _post_experience(id: String) -> void:
	if mock:
		return
	await _api_post("/api/profile/experience", { "experience": id })

func _mark_step_done() -> void:
	if mock:
		return
	await _api_post("/api/profile/onboarding", { "step": 1 })

# Thin HTTPRequest wrappers (token appended like guide_hud.gd).
func _api_get(path: String) -> Dictionary:
	if NetworkManager.session_token == "":
		return {}
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path
	url += ("&" if path.contains("?") else "?") + "token=" + NetworkManager.session_token.uri_encode()
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)
	var r: Array = await req.request_completed
	req.queue_free()
	if int(r[1]) != 200 or (r[3] as PackedByteArray).size() == 0:
		return {}
	var json = JSON.parse_string((r[3] as PackedByteArray).get_string_from_utf8())
	return json if typeof(json) == TYPE_DICTIONARY else {}

func _api_post(path: String, payload: Dictionary) -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path + "?token=" + NetworkManager.session_token.uri_encode()
	req.request(url, PackedStringArray(["Content-Type: application/json"]),
		HTTPClient.METHOD_POST, JSON.stringify(payload))
	await req.request_completed
	req.queue_free()
