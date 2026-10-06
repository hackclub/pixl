extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const MAX_LINES := 120
const LINE_TTL := 11.0
const FADE_TIME := 0.6
const WRAP_WIDTH := 620.0
const LINE_FONT_SIZE := 22

const COLOR_TEXT := Color(0.956863, 0.890196, 0.760784)
const COLOR_DIM := Color(0.788235, 0.694118, 0.54902)
const COLOR_ACCENT := Color(1, 0.819608, 0.4)
const COLOR_DM := Color(0.85, 0.72, 1)

@onready var _scroll: ScrollContainer = %Scroll
@onready var _lines_box: VBoxContainer = %Lines
@onready var _hint: Label = %Hint
@onready var _input: LineEdit = %Input

var _lines: Array[Dictionary] = []
const COMMANDS := [
	["/w", "/w <name> <message>", "whisper someone privately"],
	["/pixo", "/pixo <question>", "ask Pixo anything, only you see the reply"],
]
var _suggest: PanelContainer
var _suggest_list: VBoxContainer
var _open_bg: ColorRect
var _unread := 0
var _line_style: StyleBoxFlat
var _bold_font: FontVariation
var _italic_font: FontVariation
var _bold_italic_font: FontVariation
var _paste_cb
var _paste_fail_cb
var _last_paste_text := ""
var _last_paste_ms := 0
var _closing := false
var _censor_regex := RegEx.create_from_string("([jJ])[oO]([bB])")
# Strip [img]…[/img] from user chat so nobody can force-load arbitrary URLs.
var _img_regex := RegEx.create_from_string("\\[img\\b[^\\]]*\\][\\s\\S]*?\\[/img\\]")
# Match any bbcode tag, for measuring the rendered text width.
var _tag_regex := RegEx.create_from_string("\\[/?[a-zA-Z][^\\]]*\\]")

# Escape brackets so names / system text can't inject bbcode.
func _bb_escape(s: String) -> String:
	return s.replace("[", "[lb]").replace("]", "[rb]")

# Keep formatting bbcode in a message but drop images.
func _sanitize_bb(s: String) -> String:
	return _img_regex.sub(s, "", true)

# Plain text (tags removed) for width measurement.
func _strip_bb(s: String) -> String:
	return _tag_regex.sub(s, "", true).replace("[lb]", "[").replace("[rb]", "]")

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	NetworkManager.chat_message.connect(_on_chat)
	NetworkManager.dm_received.connect(_on_dm)
	NetworkManager.dm_error.connect(add_system)
	_input.text_submitted.connect(_on_submit)
	_input.text_changed.connect(_on_text_changed)
	_input.focus_exited.connect(_on_focus_exited)
	_build_suggestions()
	_build_open_bg()

	# Desktop pastes via the OS clipboard fine; the web export can't reach the
	# system clipboard directly, so bridge it in from the browser. Two paths,
	# both registered directly in JS (not triggered from Godot's own gui_input)
	# because routing the trigger through Godot's WASM event queue first loses
	# the browser's transient-activation window, which navigator.clipboard
	# needs - by the time GDScript calls back out to JS, Chrome no longer
	# considers it part of the trusted user gesture and silently rejects it.
	#  1) the native DOM "paste" event (real Ctrl+V, no permission prompt).
	#  2) a document-level keydown listener (capture phase, so it runs even if
	#     Godot's own canvas handler stops the event) calling
	#     navigator.clipboard.readText() synchronously inside that real event.
	# Both funnel into _on_js_paste; _last_paste_text/_last_paste_ms dedupe so
	# a browser where both paths fire doesn't insert the text twice.
	if OS.has_feature("web"):
		_paste_cb = JavaScriptBridge.create_callback(_on_js_paste)
		_paste_fail_cb = JavaScriptBridge.create_callback(_on_js_paste_fail)
		JavaScriptBridge.get_interface("window").pixlPaste = _paste_cb
		JavaScriptBridge.get_interface("window").pixlPasteFail = _paste_fail_cb
		JavaScriptBridge.eval(
			"document.addEventListener('paste', function(e){ " +
			"var t = (e.clipboardData || window.clipboardData).getData('text'); " +
			"if (t && window.pixlPaste) window.pixlPaste(t); " +
			"});" +
			"document.addEventListener('keydown', function(e){ " +
			"if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { " +
			"navigator.clipboard.readText().then(function(t){ if (t && window.pixlPaste) window.pixlPaste(t); })" +
			".catch(function(){ if (window.pixlPasteFail) window.pixlPasteFail(); }); " +
			"} " +
			"}, true);",
			true,
		)

	var input_bg := StyleBoxFlat.new()
	input_bg.bg_color = Color(0, 0, 0, 0.72)
	input_bg.set_border_width_all(2)
	input_bg.border_color = Color(1, 1, 1, 0.18)
	input_bg.content_margin_left = 8.0
	input_bg.content_margin_right = 8.0
	input_bg.content_margin_top = 5.0
	input_bg.content_margin_bottom = 5.0
	input_bg.anti_aliasing = false
	_input.add_theme_stylebox_override("normal", input_bg)
	_input.add_theme_stylebox_override("focus", input_bg)
	_input.offset_right = 636.0
	_input.add_theme_font_size_override("font_size", 20)
	_lines_box.add_theme_constant_override("separation", 3)
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER

	_line_style = StyleBoxFlat.new()
	_line_style.bg_color = Color(0, 0, 0, 0.6)
	_line_style.set_border_width_all(1)
	_line_style.border_color = Color(1, 1, 1, 0.1)
	_line_style.content_margin_left = 5.0
	_line_style.content_margin_right = 5.0
	_line_style.content_margin_top = 1.0
	_line_style.content_margin_bottom = 2.0
	_line_style.anti_aliasing = false

	# The pixel font has no bold/italic files, so [b]/[i] have nothing to switch
	# to. Synthesize them: fake-bold via embolden, italic via a shear transform.
	var base_font := _lines_box.get_theme_default_font()
	var italic_shear := Transform2D(Vector2(1.0, 0.0), Vector2(0.22, 1.0), Vector2.ZERO)
	_bold_font = FontVariation.new()
	_bold_font.base_font = base_font
	_bold_font.variation_embolden = 1.0
	_italic_font = FontVariation.new()
	_italic_font.base_font = base_font
	_italic_font.variation_transform = italic_shear
	_bold_italic_font = FontVariation.new()
	_bold_italic_font.base_font = base_font
	_bold_italic_font.variation_embolden = 1.0
	_bold_italic_font.variation_transform = italic_shear

	_hint.add_theme_color_override("font_outline_color", Color.BLACK)
	_hint.add_theme_constant_override("outline_size", 3)
	_hint.add_theme_font_size_override("font_size", 18)
	_update_hint()

func _process(_delta: float) -> void:
	visible = _in_gameplay() and not global.ui_blocked() and not global.hud_hidden
	if _input.has_focus():
		return
	var now := Time.get_ticks_msec() / 1000.0
	for line in _lines:
		if line["fading"] or now < line["expire"]:
			continue
		line["fading"] = true
		var tw := create_tween()
		tw.tween_property(line["panel"], "modulate:a", 0.0, FADE_TIME)
		line["tween"] = tw

func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			if not _input.has_focus():
				_open_input()
				get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and _input.has_focus():
			_close_input()
			get_viewport().set_input_as_handled()

func is_typing() -> bool:
	return _input.has_focus()

func open_with_text(text: String) -> void:
	_open_input()
	_input.text = text
	_input.caret_column = _input.text.length()

func add_system(text: String) -> void:
	_add_line(_bb_escape(text), COLOR_ACCENT, true)

func _open_input() -> void:
	_unread = 0
	_update_hint()
	_hint.visible = false
	if _open_bg:
		_open_bg.visible = true
	_input.clear()
	_input.visible = true
	_input.grab_focus()
	# Open chat is a scrollable history; closed it's just floating lines.
	_scroll.mouse_filter = Control.MOUSE_FILTER_STOP
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	_scroll_to_bottom()
	for line in _lines:
		if line["tween"] != null:
			line["tween"].kill()
			line["tween"] = null
		line["fading"] = false
		line["expire"] = INF
		line["panel"].modulate.a = 1.0
		line["label"].mouse_filter = Control.MOUSE_FILTER_STOP

func _close_input() -> void:
	if _closing:
		return
	_closing = true
	_input.visible = false
	_input.release_focus()
	_hint.visible = true
	_scroll.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_scroll_to_bottom()
	var now := Time.get_ticks_msec() / 1000.0
	for line in _lines:
		line["fading"] = false
		line["expire"] = now + LINE_TTL
		line["panel"].modulate.a = 1.0
		line["label"].mouse_filter = Control.MOUSE_FILTER_IGNORE
	_closing = false
	if _suggest:
		_suggest.visible = false
	if _open_bg:
		_open_bg.visible = false

func _build_open_bg() -> void:
	_open_bg = ColorRect.new()
	_open_bg.color = Color(0, 0, 0, 0.5)
	_open_bg.visible = false
	_open_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var root := _input.get_parent()
	root.add_child(_open_bg)
	root.move_child(_open_bg, 0)
	_open_bg.anchor_top = 1.0
	_open_bg.anchor_bottom = 1.0
	_open_bg.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_open_bg.offset_left = 8.0
	_open_bg.offset_right = 640.0
	_open_bg.offset_top = -480.0
	_open_bg.offset_bottom = -50.0

func _build_suggestions() -> void:
	_suggest = PanelContainer.new()
	_suggest.visible = false
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.04, 0.03, 0.92)
	sb.set_border_width_all(1)
	sb.border_color = Color(1, 1, 1, 0.12)
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 4
	sb.content_margin_right = 4
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	_suggest.add_theme_stylebox_override("panel", sb)
	_suggest_list = VBoxContainer.new()
	_suggest_list.add_theme_constant_override("separation", 2)
	_suggest.add_child(_suggest_list)
	var root := _input.get_parent()
	root.add_child(_suggest)
	_suggest.anchor_top = 1.0
	_suggest.anchor_bottom = 1.0
	_suggest.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_suggest.offset_left = 12.0
	_suggest.offset_right = 452.0
	_suggest.offset_bottom = -56.0

func _on_text_changed(new_text: String) -> void:
	var t := new_text.strip_edges()
	if not t.begins_with("/") or t.find(" ") != -1:
		_suggest.visible = false
		return
	var prefix := t.to_lower()
	for child in _suggest_list.get_children():
		child.queue_free()
	var any := false
	for c in COMMANDS:
		if prefix == "/" or String(c[0]).to_lower().begins_with(prefix):
			var b := Button.new()
			b.text = "%s   %s" % [c[1], c[2]]
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.flat = true
			b.focus_mode = Control.FOCUS_NONE
			b.add_theme_font_size_override("font_size", 13)
			b.add_theme_color_override("font_color", COLOR_DIM)
			b.pressed.connect(_pick_command.bind(String(c[0])))
			_suggest_list.add_child(b)
			any = true
	_suggest.visible = any

func _pick_command(cmd: String) -> void:
	_input.text = cmd + " "
	_input.caret_column = _input.text.length()
	_input.grab_focus()
	_suggest.visible = false

func _on_focus_exited() -> void:
	if _input.visible:
		_close_input()

func _on_js_paste(args: Array) -> void:
	if args.is_empty() or not _input.visible:
		return
	var text := String(args[0]).replace("\r", "").replace("\n", " ")
	if text == "":
		return
	# The native "paste" event and the Ctrl+V clipboard-read fallback can both
	# fire for the same keystroke in some browsers; skip an exact repeat that
	# lands within half a second so the text isn't inserted twice.
	var now := Time.get_ticks_msec()
	if text == _last_paste_text and now - _last_paste_ms < 500:
		return
	_last_paste_text = text
	_last_paste_ms = now
	_input.insert_text_at_caret(text)

func _on_js_paste_fail(_args: Array) -> void:
	add_system("Couldn't paste , your browser blocked clipboard access.")

func _on_submit(text: String) -> void:
	var t := text.strip_edges()
	if t.begins_with("/w ") or t.begins_with("/msg "):
		var rest := t.substr(t.find(" ") + 1).strip_edges()
		var space := rest.find(" ")
		if space <= 0:
			add_system("Usage: /w <name> <message>")
		elif not NetworkManager.send_dm(rest.substr(0, space), rest.substr(space + 1).strip_edges()):
			add_system("Lost the connection, so that didn't send. Reconnecting, try again in a moment.")
	elif t != "":
		if not NetworkManager.send_chat(t):
			add_system("Lost the connection, so that didn't send. Reconnecting, try again in a moment.")
	_close_input()

func _censor(text: String) -> String:
	return _censor_regex.sub(text, "$1*$2", true)

func _on_chat(user_id: String, display_name: String, text: String) -> void:
	_add_line("%s: %s" % [_bb_escape(display_name), _sanitize_bb(_censor(text))], COLOR_TEXT, user_id == NetworkManager.user_id)

func _on_dm(from_name: String, to_name: String, text: String, outgoing: bool) -> void:
	var prefix := "to %s" % to_name if outgoing else "from %s" % from_name
	_add_line("[lb]%s[rb] %s" % [_bb_escape(prefix), _sanitize_bb(_censor(text))], COLOR_DM, outgoing)

func _scroll_to_bottom() -> void:
	await get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)

func _add_line(display: String, color: Color, own: bool) -> void:
	# Don't yank the view down if someone is reading older messages.
	var bar := _scroll.get_v_scroll_bar()
	var was_at_bottom := bar.value >= bar.max_value - bar.page - 4.0
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _line_style)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.selection_enabled = true
	# Lines pass mouse events through while just floating on top of gameplay
	# (so clicks/movement reach the world underneath), but become selectable
	# for copy once the chat box is open and they're pinned on screen.
	label.mouse_filter = Control.MOUSE_FILTER_STOP if _input.has_focus() else Control.MOUSE_FILTER_IGNORE
	label.add_theme_color_override("default_color", color)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 3)
	label.add_theme_font_override("bold_font", _bold_font)
	label.add_theme_font_override("italics_font", _italic_font)
	label.add_theme_font_override("bold_italics_font", _bold_italic_font)
	label.add_theme_font_size_override("normal_font_size", LINE_FONT_SIZE)
	label.add_theme_font_size_override("bold_font_size", LINE_FONT_SIZE)
	label.add_theme_font_size_override("italics_font_size", LINE_FONT_SIZE)
	label.add_theme_font_size_override("bold_italics_font_size", LINE_FONT_SIZE)

	var font := _lines_box.get_theme_default_font()
	var text_w := font.get_string_size(_strip_bb(display), HORIZONTAL_ALIGNMENT_LEFT, -1, LINE_FONT_SIZE).x
	if text_w > WRAP_WIDTH:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.custom_minimum_size = Vector2(WRAP_WIDTH, 0)
		panel.size_flags_horizontal = Control.SIZE_FILL
	else:
		label.autowrap_mode = TextServer.AUTOWRAP_OFF
		label.custom_minimum_size = Vector2(text_w + 8.0, 0)
		panel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	label.text = display

	panel.add_child(label)
	_lines_box.add_child(panel)
	panel.scale = Vector2(0.7, 0.7)
	var pop := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	pop.tween_property(panel, "scale", Vector2.ONE, 0.22)

	var line := {"panel": panel, "label": label, "expire": INF, "fading": false, "tween": null}
	if not _input.has_focus():
		line["expire"] = Time.get_ticks_msec() / 1000.0 + LINE_TTL
	_lines.append(line)

	while _lines.size() > MAX_LINES:
		var old: Dictionary = _lines.pop_front()
		if old["tween"] != null:
			old["tween"].kill()
		old["panel"].queue_free()

	if was_at_bottom or own:
		_scroll_to_bottom()

	if not own and not _input.has_focus():
		_unread += 1
		_update_hint()

func _update_hint() -> void:
	if _unread > 0:
		_hint.text = "Press Enter to chat  (%d new)" % _unread
		_hint.add_theme_color_override("font_color", Color(COLOR_ACCENT, 0.95))
	else:
		_hint.text = "Press Enter to chat"
		_hint.add_theme_color_override("font_color", Color(COLOR_DIM, 0.55))

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())
