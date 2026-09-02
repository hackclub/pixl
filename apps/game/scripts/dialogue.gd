extends CanvasLayer

signal closed
## Emitted when the player picks an option in `ask()` mode. `index` is the
## 0-based option, `id` is the matching entry from the ids array (or "" ).
signal chosen(index: int, id: String)

const THEME := preload("res://themes/main_theme.tres")
## Characters revealed per second while a line types on. Tuned so a ~120-char
## line lands in ~2.5s; [E] snaps to full instantly (see _skip_or_advance).
const TYPE_CPS := 48.0

var is_open := false
var _wrap: Control
var _portrait: TextureRect
var _speaker: Label
var _body: Label
var _hint: Label
var _choices: VBoxContainer
var _lines: PackedStringArray = PackedStringArray()
var _index := 0
# Choice mode: options + parallel id list, live only between ask() and a pick.
var _choosing := false
var _choice_ids: PackedStringArray = PackedStringArray()
# Typewriter state for the current line.
var _typing := false
var _type_len := 0

func _ready() -> void:
	layer = 110
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()

func _build_ui() -> void:
	_wrap = Control.new()
	_wrap.set_anchors_preset(Control.PRESET_FULL_RECT)
	_wrap.mouse_filter = Control.MOUSE_FILTER_STOP
	_wrap.gui_input.connect(_on_wrap_gui_input)  # tap-to-advance, mobile has no [E]
	_wrap.theme = THEME
	_wrap.visible = false
	add_child(_wrap)

	# Bottom-centred panel that grows UPWARD to fit its content (short lines stay
	# compact; the choice prompt expands to fit the buttons). offset_top ==
	# offset_bottom gives a zero-height base that grow_vertical=BEGIN inflates to
	# the content's minimum size, floored by custom_minimum_size.y.
	var panel := PanelContainer.new()
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 1.0
	panel.anchor_bottom = 1.0
	panel.offset_left = -520
	panel.offset_right = 520
	panel.offset_top = -28
	panel.offset_bottom = -28
	panel.custom_minimum_size = Vector2(0, 120)
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	# Containers default to STOP - left alone they'd catch taps on the panel
	# before _wrap's gui_input ever saw them (same bug as the cinematic's _bg).
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_wrap.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 22)
	margin.add_theme_constant_override("margin_right", 22)
	margin.add_theme_constant_override("margin_top", 16)
	margin.add_theme_constant_override("margin_bottom", 14)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(margin)

	# Portrait (optional) sits left of the text column.
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 14)
	cols.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(cols)

	_portrait = TextureRect.new()
	_portrait.custom_minimum_size = Vector2(96, 96)
	_portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_portrait.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_portrait.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_portrait.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_portrait.visible = false
	cols.add_child(_portrait)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	vbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cols.add_child(vbox)

	_speaker = Label.new()
	_speaker.theme_type_variation = &"TitleText"
	_speaker.add_theme_font_size_override("font_size", 24)
	vbox.add_child(_speaker)

	_body = Label.new()
	_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.add_theme_font_size_override("font_size", 22)
	vbox.add_child(_body)

	_choices = VBoxContainer.new()
	_choices.add_theme_constant_override("separation", 6)
	_choices.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_choices.visible = false
	vbox.add_child(_choices)

	_hint = Label.new()
	_hint.theme_type_variation = &"InfoText"
	_hint.add_theme_font_size_override("font_size", 16)
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	vbox.add_child(_hint)

## Show a linear run of lines. `portrait` (optional) shows a character bust.
## Unchanged call sites - open(speaker, lines) - keep working exactly as before.
func open(speaker: String, lines, portrait: Texture2D = null) -> void:
	var arr := PackedStringArray()
	for l in lines:
		var s := String(l).strip_edges()
		if s != "":
			arr.append(s)
	if arr.is_empty():
		return
	_reset_choice()
	_lines = arr
	_index = 0
	is_open = true
	_speaker.text = speaker
	_set_portrait(portrait)
	_choices.visible = false
	_show_line(0)
	_wrap.visible = true

## Show prompt line(s), then a set of buttons. Emits `chosen(index, id)` and
## then closes when the player picks. `ids` (optional) is a parallel array of
## stable string ids returned alongside the index. Awaitable:
##   var picked = await Dialogue.chosen
func ask(speaker: String, prompt, options: PackedStringArray, ids: PackedStringArray = PackedStringArray(), portrait: Texture2D = null) -> void:
	var arr := PackedStringArray()
	for l in prompt:
		var s := String(l).strip_edges()
		if s != "":
			arr.append(s)
	if options.is_empty():
		return
	_reset_choice()
	_lines = arr
	_index = 0
	is_open = true
	_choosing = true
	_choice_ids = ids
	_speaker.text = speaker
	_set_portrait(portrait)
	# Prompt lines type through first; the buttons only appear on the last line.
	if arr.is_empty():
		_body.text = ""
		_reveal_choices(options)
	else:
		_pending_options = options
		_show_line(0)
	_wrap.visible = true

var _pending_options: PackedStringArray = PackedStringArray()

func _reveal_choices(options: PackedStringArray) -> void:
	_hint.text = ""
	for c in _choices.get_children():
		c.queue_free()
	for i in options.size():
		var b := Button.new()
		b.text = String(options[i])
		b.add_theme_font_size_override("font_size", 20)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(_on_choice.bind(i))
		_choices.add_child(b)
	_choices.visible = true
	await get_tree().process_frame
	if _choices.get_child_count() > 0:
		(_choices.get_child(0) as Button).grab_focus()

func _on_choice(index: int) -> void:
	if not _choosing:
		return
	var id := ""
	if index >= 0 and index < _choice_ids.size():
		id = String(_choice_ids[index])
	_choosing = false
	chosen.emit(index, id)
	close()

# Reveal one line with the typewriter effect.
func _show_line(n: int) -> void:
	_index = n
	var text := _lines[n]
	_body.text = text
	_type_len = text.length()
	_body.visible_characters = 0
	_typing = _type_len > 0
	var last := n == _lines.size() - 1
	if _choosing and last:
		_hint.text = ""
	elif last:
		_hint.text = "[E] close"
	else:
		_hint.text = "[E]"

func _process(delta: float) -> void:
	if not _typing:
		return
	_body.visible_characters = mini(
		_type_len,
		_body.visible_characters + int(ceil(TYPE_CPS * delta)),
	)
	if _body.visible_characters >= _type_len:
		_typing = false
		_on_line_typed()

func _on_line_typed() -> void:
	var last := _index == _lines.size() - 1
	if _choosing and last:
		_reveal_choices(_pending_options)
	elif not last:
		_hint.text = "[E] next"

func advance() -> void:
	if _choosing:
		# In choice mode, [E] walks through the prompt lines; the last line
		# reveals the buttons instead of closing. Once the buttons are up,
		# _unhandled_input stops feeding us [E] (the player must click).
		if _index >= _lines.size() - 1:
			if not _choices.visible:
				_reveal_choices(_pending_options)
			return
		_show_line(_index + 1)
		return
	_index += 1
	if _index >= _lines.size():
		close()
		return
	_show_line(_index)

# [E] snaps a still-typing line to full first, otherwise advances.
func _skip_or_advance() -> void:
	if _typing:
		_typing = false
		_body.visible_characters = _type_len
		_on_line_typed()
		return
	advance()

func close() -> void:
	is_open = false
	_typing = false
	_wrap.visible = false
	_reset_choice()
	closed.emit()

func _reset_choice() -> void:
	_choosing = false
	_choice_ids = PackedStringArray()
	_pending_options = PackedStringArray()
	if _choices:
		_choices.visible = false
		for c in _choices.get_children():
			c.queue_free()

func _set_portrait(tex: Texture2D) -> void:
	if _portrait == null:
		return
	_portrait.texture = tex
	_portrait.visible = tex != null

func _unhandled_input(event: InputEvent) -> void:
	if not is_open:
		return
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		# A choice prompt (ask()) only ever resolves its `chosen` signal from
		# _on_choice(), closing here instead would leave any caller awaiting
		# `Dialogue.chosen` (e.g. onboarding.gd's arrival flow) suspended
		# forever, which also permanently strands global.ui_blockers at 1
		# since the blocking coroutine never reaches its release. So Esc is a
		# no-op during an active choice prompt, the player has to pick one.
		if _choosing:
			return
		close()
		return
	# While the choice buttons are up, [E] is inert, the player must click one.
	# Before that (prompt still typing / more prompt lines), [E] advances.
	if _choosing and _choices.visible:
		return
	if event.is_action_pressed("interact"):
		get_viewport().set_input_as_handled()
		_skip_or_advance()

# _wrap eats taps via MOUSE_FILTER_STOP; a choice Button underneath still gets
# first dibs on its own rect, so this only fires for taps on empty space -
# same gating as [E] in _unhandled_input above.
func _on_wrap_gui_input(event: InputEvent) -> void:
	if not is_open:
		return
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	if _choosing and _choices.visible:
		return
	_skip_or_advance()
